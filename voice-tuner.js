/* Kotodama Voice Tuner — local, microphone-only pitch analysis.
   Mic samples are never sent to a server or connected to audio output. */
(() => {
  'use strict';
  const button = document.getElementById('btn-voice');
  const toneButton = document.getElementById('action-btn');
  const soundButton = document.getElementById('btn-sound');
  const panel = document.getElementById('voice-panel');
  const status = document.getElementById('voice-status');
  const noteLabel = document.getElementById('voice-note');
  const frequencyLabel = document.getElementById('voice-freq');
  const centsLabel = document.getElementById('voice-cents');
  const targetNote = document.getElementById('voice-target-note');
  const targetFrequencyLabel = document.getElementById('voice-target-freq');
  const needle = document.getElementById('voice-needle');
  const direction = document.getElementById('voice-direction');
  const levelFill = document.getElementById('voice-level-fill');
  const guideButton = document.getElementById('btn-guide');
  const sensitivityButton = document.getElementById('btn-mic-gain');
  const smoothingButton = document.getElementById('btn-voice-smoothing');
  const modeButton = document.getElementById('btn-voice-mode');
  const notationButton = document.getElementById('btn-voice-notation');
  const octaveButton = document.getElementById('btn-voice-octave');
  if (smoothingButton) smoothingButton.textContent = '追従: 安定';
  const targetModeLabel = document.getElementById('voice-target-mode-label');
  if (!button || !panel) return;

  let stream = null, context = null, source = null, inputGain = null, analyser = null;
  let samples = null, frameId = 0, lastScan = 0, active = false, starting = false;
  let recent = [];
  const RESPONSE_MODES = [
    { label: '敏感', tau: 65, holdMs: 90, hysteresis: 5 },
    { label: '標準', tau: 220, holdMs: 190, hysteresis: 10 },
    { label: '安定', tau: 450, holdMs: 330, hysteresis: 15 }
  ];
  let responseIndex = 2; // 安定 is the default; 敏感／標準 remain selectable.
  let smoothedMidi = null, selectedMidi = null, lastSmoothAt = 0, lastGoodPitchAt = 0;
  const inputSensitivity = [16, 32, 64];
  let sensitivityIndex = 0; // 16x starting point; 32x / 64x for quiet iPad microphones.
  let targetFrequency = 130.81278265, baseTargetFrequency = 130.81278265;
  let lastDetectedHz = null, currentGuideFrequency = null;
  let mode = 'free', notation = 'solfege', octaveIndex = 0;
  let appliedNotation = null;
  const octaves = ['auto', 2, 3, 4, 5];
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const SOLFEGE_NAMES = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
  // Chakra-like colors around the 12 pitch classes. No new animation timer.
  const PITCH_OUTLINE_COLORS = [
    '#FF5555', '#FF8055', '#FFAB42', '#FFD45A',
    '#E9D45B', '#57D67D', '#3ED1AF', '#36C6E6',
    '#569FEF', '#7896FF', '#AA83F5', '#DD90E7'
  ];
  const NATURAL_INDICES = { 0:0, 2:1, 4:2, 5:3, 7:4, 9:5, 11:6 };
  let guideAudio = null, guideUrl = null, guideUntil = 0, guideTimer = 0;
  let guidePreviousSessionType = null;

  // Lightweight YIN-style cumulative mean normalized difference.
  // Designed for a single singing/humming voice, not chords.
  function estimatePitch(input, sampleRate) {
    let power = 0;
    for (let i = 0; i < input.length; i++) power += input[i] * input[i];
    const rms = Math.sqrt(power / input.length);
    if (rms < 0.014) return null;

    const stride = 2;
    const rate = sampleRate / stride;
    const minLag = Math.floor(rate / 1100);
    const maxLag = Math.min(Math.floor(rate / 60), 430);
    const length = Math.min(1000, Math.floor(input.length / stride) - maxLag - 1);
    if (length < 250) return null;

    const differences = new Float32Array(maxLag + 1);
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < length; i++) {
        const delta = input[i * stride] - input[(i + lag) * stride];
        sum += delta * delta;
      }
      differences[lag] = sum;
    }

    let running = 0;
    let chosen = -1;
    const normalized = new Float32Array(maxLag + 1);
    for (let lag = 1; lag <= maxLag; lag++) {
      running += differences[lag];
      normalized[lag] = running === 0 ? 1 : differences[lag] * lag / running;
    }
    // Compute the full curve before looking ahead to the local minimum.
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (normalized[lag] < 0.16) {
        while (lag + 1 <= maxLag && normalized[lag + 1] < normalized[lag]) lag++;
        chosen = lag;
        break;
      }
    }
    if (chosen < 0) return null;

    // Parabolic correction reduces the tuning jitter between sample lags.
    const left = normalized[Math.max(chosen - 1, 1)];
    const middle = normalized[chosen];
    const right = normalized[Math.min(chosen + 1, maxLag)];
    const denominator = left - 2 * middle + right;
    const correction = Math.abs(denominator) > 1e-9
      ? Math.max(-1, Math.min(1, 0.5 * (left - right) / denominator))
      : 0;
    const frequency = rate / (chosen + correction);
    return Number.isFinite(frequency) && frequency >= 60 && frequency <= 1100 ? frequency : null;
  }

  function freqToMidi(frequency) {
    return 69 + 12 * Math.log2(frequency / 440);
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function pitchClass(midi) {
    return ((midi % 12) + 12) % 12;
  }

  function getNoteName(frequency) {
    if (!Number.isFinite(frequency) || frequency <= 0) return '—';
    const midi = Math.round(freqToMidi(frequency));
    const names = notation === 'solfege' ? SOLFEGE_NAMES : NAMES;
    return names[pitchClass(midi)] + (Math.floor(midi / 12) - 1);
  }

  function getManualTarget() {
    const baseMidi = Math.round(freqToMidi(baseTargetFrequency));
    const noteClass = pitchClass(baseMidi);
    let octave = octaves[octaveIndex];
    if (octave === 'auto') {
      octave = lastDetectedHz === null
        ? 3
        : Math.max(1, Math.min(7, Math.round((freqToMidi(lastDetectedHz) - noteClass) / 12) - 1));
    }
    return midiToFreq((octave + 1) * 12 + noteClass);
  }

  function showTarget(referenceHz) {
    if (mode === 'free') {
      targetModeLabel.textContent = '自動判定';
      targetNote.textContent = referenceHz === null ? '—' : getNoteName(referenceHz);
      targetFrequencyLabel.textContent = referenceHz === null
        ? '声に合わせて音名・オクターブが変わります'
        : referenceHz.toFixed(1) + ' Hz（最寄りの音）';
    } else {
      targetModeLabel.textContent = '目標音';
      targetNote.textContent = getNoteName(referenceHz);
      targetFrequencyLabel.textContent = referenceHz.toFixed(1) + ' Hz';
    }
  }

  function updateControls() {
    modeButton.textContent = mode === 'free' ? 'モード: フリー' : 'モード: 目標音';
    notationButton.textContent = notation === 'solfege' ? '表示: ドレミ' : '表示: CDE';
    octaveButton.textContent = '音域: ' + (octaves[octaveIndex] === 'auto' ? '自動' : octaves[octaveIndex]);
    octaveButton.disabled = mode === 'free';
    // Free mode tracks the voice automatically; guide tone is meaningful only with a fixed target.
    guideButton.disabled = mode !== 'target' || !active ||
      currentGuideFrequency === null || guideAudio !== null;
    guideButton.textContent = mode === 'free' ? 'ガイド: 目標音のみ' : 'ガイド音を鳴らす';
    if ((active || starting) && appliedNotation !== notation && window.kotodamaSetVoiceLabels) {
      window.kotodamaSetVoiceLabels(true, notation);
      appliedNotation = notation;
    }
  }

  function updateSelectedButton(midi) {
    if (!window.kotodamaSetVoiceSelection) return;
    const selected = pitchClass(midi);
    window.kotodamaSetVoiceSelection(
      Object.prototype.hasOwnProperty.call(NATURAL_INDICES, selected)
        ? NATURAL_INDICES[selected] : -1
    );
  }

  function setTarget(frequency) {
    if (!Number.isFinite(frequency) || frequency <= 0) return;
    baseTargetFrequency = frequency;
    if (mode === 'target') {
      targetFrequency = getManualTarget();
      currentGuideFrequency = targetFrequency;
      showTarget(targetFrequency);
      updateSelectedButton(Math.round(freqToMidi(baseTargetFrequency)));
    }
    updateControls();
  }

  function setVoiceNoteOutline(frequency) {
    const color = Number.isFinite(frequency) && frequency > 0
      ? PITCH_OUTLINE_COLORS[pitchClass(Math.round(freqToMidi(frequency)))]
      : '#91A5BA';
    // The large detected-note glyph stays legible; only its outline/glow changes.
    noteLabel.style.webkitTextStrokeColor = color;
    noteLabel.style.textShadow = '0 0 12px ' + color + ', 0 0 27px ' + color;
  }

  function updateInputLevel(input) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    levelFill.style.width = Math.min(100, Math.round(rms * 550)) + '%';
    return rms;
  }

  function resetPitchFilter() {
    recent = [];
    smoothedMidi = null;
    selectedMidi = null;
    lastSmoothAt = 0;
    lastGoodPitchAt = 0;
  }

  function stabilizePitch(frequency, now) {
    // Median of three frames removes isolated jumps.
    // EMA in semitones smooths by approximately the same cents at all octaves.
    recent.push(frequency);
    if (recent.length > 3) recent.shift();
    const sorted = [...recent].sort((a, b) => a - b);
    const sampleMidi = freqToMidi(sorted[Math.floor(sorted.length / 2)]);
    const settings = RESPONSE_MODES[responseIndex];
    if (smoothedMidi === null) {
      smoothedMidi = sampleMidi;
      selectedMidi = Math.round(sampleMidi);
    } else {
      const dt = lastSmoothAt ? Math.max(12, Math.min(250, now - lastSmoothAt)) : 75;
      const difference = Math.abs(sampleMidi - smoothedMidi);
      const tau = difference > 0.85 ? settings.tau * 0.45 : settings.tau;
      const alpha = 1 - Math.exp(-dt / tau);
      smoothedMidi += (sampleMidi - smoothedMidi) * alpha;
      if (Math.abs(smoothedMidi - selectedMidi) >= 0.5 + settings.hysteresis / 100) {
        selectedMidi = Math.round(smoothedMidi);
      }
    }
    lastSmoothAt = now;
    lastGoodPitchAt = now;
    return { frequency: midiToFreq(smoothedMidi), noteMidi: selectedMidi };
  }

  function showPitch(frequency, force = false, now = performance.now()) {
    if (frequency === null) {
      if (!force && lastGoodPitchAt > 0 &&
          now - lastGoodPitchAt < RESPONSE_MODES[responseIndex].holdMs) {
        return; // brief pitch-dropout should not flicker the UI
      }
      resetPitchFilter();
      lastDetectedHz = null;
      noteLabel.textContent = '—';
      frequencyLabel.textContent = '声を出してください';
      centsLabel.textContent = '— cent';
      needle.style.left = '50%';
      direction.textContent = mode === 'free' ? '声に合わせて音名を自動判定' : '目標音に合わせて声を出してください';
      if (mode === 'free') {
        currentGuideFrequency = null;
        showTarget(null);
        if (window.kotodamaSetVoiceSelection) window.kotodamaSetVoiceSelection(-1);
      } else {
        targetFrequency = getManualTarget();
        currentGuideFrequency = targetFrequency;
        showTarget(targetFrequency);
      }
      setVoiceNoteOutline(null);
      updateControls();
      return;
    }

    const stabilized = stabilizePitch(frequency, now);
    const stable = stabilized.frequency;
    lastDetectedHz = stable;

    if (mode === 'free') {
      targetFrequency = midiToFreq(stabilized.noteMidi);
      updateSelectedButton(stabilized.noteMidi);
    } else {
      targetFrequency = getManualTarget();
      updateSelectedButton(Math.round(freqToMidi(baseTargetFrequency)));
    }
    currentGuideFrequency = targetFrequency;
    showTarget(targetFrequency);

    const deltaCents = Math.round(1200 * Math.log2(stable / targetFrequency));
    noteLabel.textContent = getNoteName(mode === 'free'
      ? midiToFreq(stabilized.noteMidi) : stable);
    setVoiceNoteOutline(mode === 'free' ? targetFrequency : stable);
    frequencyLabel.textContent = stable.toFixed(1) + ' Hz';
    centsLabel.textContent = (deltaCents > 0 ? '+' : '') + deltaCents + ' cent';
    needle.style.left = (50 + Math.max(-50, Math.min(50, deltaCents)) * 0.88) + '%';
    if (Math.abs(deltaCents) <= 8) {
      direction.textContent = mode === 'free' ? '音程が安定しています' : '目標音とほぼ一致';
      needle.style.background = '#53c7a9';
    } else if (Math.abs(deltaCents) > 50) {
      direction.textContent = deltaCents < 0 ? '基準より低い（目盛り範囲外）' : '基準より高い（目盛り範囲外）';
      needle.style.background = '#fff';
    } else {
      direction.textContent = deltaCents < 0 ? 'もう少し高く' : 'もう少し低く';
      needle.style.background = '#fff';
    }
    updateControls();
  }

  function generateGuideWav(frequency) {
    // HTMLMediaElement playback has a separate iOS media audio route from the mic context.
    // PCM16, mono, 24kHz, short envelope, plus a faint second harmonic for phone speakers.
    const sampleRate = 24000, duration = 0.78;
    const frames = Math.round(sampleRate * duration);
    const buffer = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(buffer);
    function tag(position, text) {
      for (let i = 0; i < text.length; i++) view.setUint8(position + i, text.charCodeAt(i));
    }
    tag(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true);
    tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);  // PCM
    view.setUint16(22, 1, true);  // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    tag(36, 'data'); view.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
      const time = i / sampleRate;
      const phase = 2 * Math.PI * frequency * time;
      const envelope = Math.min(1, time / 0.03, (duration - time) / 0.12);
      const sample = envelope * (0.43 * Math.sin(phase) + 0.12 * Math.sin(2 * phase));
      view.setInt16(44 + 2 * i,
        Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
    }
    return new Blob([buffer], {type: 'audio/wav'});
  }

  function stopGuide() {
    if (guideTimer) clearTimeout(guideTimer);
    guideTimer = 0;
    if (guideAudio) {
      try { guideAudio.pause(); guideAudio.removeAttribute('src'); guideAudio.load(); } catch (_) {}
      guideAudio = null;
    }
    if (guideUrl) { try { URL.revokeObjectURL(guideUrl); } catch (_) {} }
    guideUrl = null;
    if (guidePreviousSessionType !== null) {
      try {
        if (navigator.audioSession) navigator.audioSession.type = guidePreviousSessionType;
      } catch (_) {}
      guidePreviousSessionType = null;
    }
    guideUntil = 0;
    guideButton.disabled = mode !== 'target' || !active || currentGuideFrequency === null;
  }

  function playGuide() {
    if (!active || mode !== 'target' || guideAudio || currentGuideFrequency === null) return;
    guideButton.disabled = true;
    try {
      // WebKit may route audio through the handset receiver while the mic is live.
      // This is a short user-initiated route switch; restore the prior type afterwards.
      if (navigator.audioSession && 'type' in navigator.audioSession) {
        try {
          guidePreviousSessionType = navigator.audioSession.type;
          navigator.audioSession.type = 'playback';
        } catch (_) { guidePreviousSessionType = null; }
      }
      guideUrl = URL.createObjectURL(generateGuideWav(currentGuideFrequency));
      guideAudio = new Audio(guideUrl);
      guideAudio.volume = 1;
      guideUntil = performance.now() + 1150;
      status.textContent = 'ガイド音を再生中（マイク解析を一時停止）';
      const playback = guideAudio.play(); // directly inside the button activation
      if (playback && typeof playback.catch === 'function') {
        playback.catch(error => {
          stopGuide();
          if (active) status.textContent = 'ガイド音を出力できません: ' + (error.message || error.name);
        });
      }
      guideTimer = setTimeout(() => {
        stopGuide();
        if (active) status.textContent = 'マイク解析に復帰しました';
      }, 1080);
    } catch (error) {
      stopGuide();
      if (active) status.textContent = 'ガイド音を出力できません: ' + (error.message || error.name);
    }
  }

  function scan(now) {
    if (!active || !analyser) return;
    frameId = requestAnimationFrame(scan);
    if (now - lastScan < 75) return;
    lastScan = now;
    try {
      analyser.getFloatTimeDomainData(samples);
      const rms = updateInputLevel(samples);
      // Keep speaker guide audio out of the pitch estimator.
      if (now < guideUntil) {
        showPitch(null, true, now);
        return;
      }
      const pitch = estimatePitch(samples, context.sampleRate);
      showPitch(pitch, false, now);
      // Very large microphone gain can overload analysis. Warn without
      // silently changing the gain selected by the user.
      let peak = 0;
      for (let i = 0; i < samples.length; i++) {
        peak = Math.max(peak, Math.abs(samples[i]));
      }
      status.textContent = peak >= 0.98
        ? '入力が大きめです。音程が不安定なら感度を下げてください'
        : pitch !== null
          ? '音程を検出中'
          : rms >= 0.014 ? '声を検知・音程を解析中' : 'マイク入力待ち（レベルを確認してください）';
    } catch (error) {
      status.textContent = '解析エラー: ' + error.message;
      void stop();
    }
  }

  async function releaseDevices() {
    active = false;
    stopGuide();
    cancelAnimationFrame(frameId);
    frameId = 0;
    if (source) { try { source.disconnect(); } catch (_) {} }
    if (inputGain) { try { inputGain.disconnect(); } catch (_) {} }
    source = null;
    inputGain = null;
    analyser = null;
    samples = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    if (context) { try { await context.close(); } catch (_) {} }
    context = null;
    resetPitchFilter();
    toneButton.disabled = false;
    soundButton.disabled = false;
  }

  async function stop() {
    await releaseDevices();
    panel.hidden = true;
    document.body.classList.remove('voice-mode');
    if (window.kotodamaSetVoiceLabels) window.kotodamaSetVoiceLabels(false);
    appliedNotation = null;
    if (window.kotodamaSetVoiceSelection) {
      window.kotodamaSetVoiceSelection(NATURAL_INDICES[pitchClass(Math.round(freqToMidi(baseTargetFrequency)))]);
    }
    document.querySelector('.title-sub').textContent = 'CHAKRA TUNER';
    status.textContent = 'マイク未使用';
    button.textContent = 'VOICE: START';
  }

  async function start() {
    if (active || starting) return;
    // Do not hide the meditation stop button while its sound is playing.
    if (typeof window.kotodamaSoundIsRunning === 'function' && window.kotodamaSoundIsRunning()) {
      const message = '先に TUNING STOP で音を停止してからVOICEを開始してください';
      if (typeof window.showToast === 'function') window.showToast(message);
      return;
    }
    starting = true;
    button.disabled = true;
    toneButton.disabled = true;
    soundButton.disabled = true;
    document.body.classList.add('voice-mode');
    if (window.kotodamaSetVoiceLabels) window.kotodamaSetVoiceLabels(true);
    document.querySelector('.title-sub').textContent = 'VOICE TUNER';
    if (window.kotodamaGetVoiceTarget) setTarget(window.kotodamaGetVoiceTarget());
    guideButton.disabled = true;
    status.textContent = 'マイクの許可を確認中…';
    panel.hidden = false;
    showPitch(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('HTTPSとマイク対応ブラウザーが必要です');
      }
      // On iOS, ask for microphone access in the original click gesture.
      // Waiting for a 2.8-second audio fade before getUserMedia can prevent
      // Safari from recognizing the interaction as user-initiated.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false
      });
      if (document.hidden) throw new Error('画面を表示してから再試行してください');
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Web Audioに対応していません');
      context = new Context();
      source = context.createMediaStreamSource(stream);
      inputGain = context.createGain();
      inputGain.gain.value = inputSensitivity[sensitivityIndex];
      analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(inputGain);
      inputGain.connect(analyser); // Never connect microphone audio to destination.
      samples = new Float32Array(analyser.fftSize);
      await context.resume();
      active = true;
      toneButton.disabled = true;
      soundButton.disabled = true;
      button.textContent = 'VOICE: STOP';
      guideButton.disabled = false;
      status.textContent = 'マイク入力中（録音・送信なし）・感度 ×' + inputSensitivity[sensitivityIndex];
      showPitch(null);
      lastScan = 0;
      frameId = requestAnimationFrame(scan);
    } catch (error) {
      await releaseDevices();
      panel.hidden = true;
      document.body.classList.remove('voice-mode');
      if (window.kotodamaSetVoiceLabels) window.kotodamaSetVoiceLabels(false);
      appliedNotation = null;
      document.querySelector('.title-sub').textContent = 'CHAKRA TUNER';
      const message = error.name === 'NotAllowedError'
        ? 'マイクが許可されていません。Safariのマイク設定をご確認ください。'
        : 'ボイスモードを開始できません: ' + (error.message || error.name);
      status.textContent = message;
      if (window.showToast) window.showToast(message);
      guideButton.disabled = true;
      button.textContent = 'VOICE: START';
    } finally {
      button.disabled = false;
      starting = false;
    }
  }

  button.addEventListener('click', () => { void (active ? stop() : start()); });
  guideButton.addEventListener('click', () => { playGuide(); });
  modeButton.addEventListener('click', () => {
    if (guideAudio) stopGuide();
    mode = mode === 'free' ? 'target' : 'free';
    resetPitchFilter();
    lastDetectedHz = null;
    showPitch(null, true);
    updateControls();
  });
  notationButton.addEventListener('click', () => {
    notation = notation === 'solfege' ? 'letter' : 'solfege';
    const previous = lastDetectedHz;
    resetPitchFilter();
    if (previous === null) showPitch(null, true);
    else showPitch(previous);
    updateControls();
  });
  octaveButton.addEventListener('click', () => {
    if (mode !== 'target') return;
    octaveIndex = (octaveIndex + 1) % octaves.length;
    const previous = lastDetectedHz;
    resetPitchFilter();
    if (previous === null) showPitch(null, true);
    else showPitch(previous);
    updateControls();
  });
  smoothingButton.addEventListener('click', () => {
    responseIndex = (responseIndex + 1) % RESPONSE_MODES.length;
    smoothingButton.textContent = '追従: ' + RESPONSE_MODES[responseIndex].label;
    if (active) status.textContent = '音程追従: ' + RESPONSE_MODES[responseIndex].label +
      '（マイク感度は変更しません）';
  });
  sensitivityButton.addEventListener('click', () => {
    sensitivityIndex = (sensitivityIndex + 1) % inputSensitivity.length;
    const value = inputSensitivity[sensitivityIndex];
    sensitivityButton.textContent = '感度 ×' + value;
    if (inputGain) inputGain.gain.value = value;
    resetPitchFilter();
    showPitch(null, true);
    if (active) status.textContent = 'マイク感度 ×' + value + '（感度を上げると雑音も増えます）';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) void stop();
  });
  window.addEventListener('pagehide', () => { if (active || stream) void stop(); });
  window.kotodamaVoiceTuner = {
    estimatePitch, stop, setTarget, generateGuideWav,
    get active() { return active; },
    get mode() { return mode; },
    get response() { return RESPONSE_MODES[responseIndex].label; }
  };
  if (window.kotodamaGetVoiceTarget) setTarget(window.kotodamaGetVoiceTarget());
})();
