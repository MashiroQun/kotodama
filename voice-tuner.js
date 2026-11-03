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
  if (!button || !panel) return;

  let stream = null, context = null, source = null, inputGain = null, analyser = null;
  let samples = null, frameId = 0, lastScan = 0, active = false, starting = false;
  let recent = [];
  const inputSensitivity = [1, 4, 8, 16];
  let sensitivityIndex = 2; // 8x is the starting point; manual override for noisy devices.
  let targetFrequency = 130.81278265;
  let guideOsc = null, guideGain = null, guideUntil = 0, guideTimer = 0;
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

  // Lightweight YIN-style cumulative mean normalized difference.
  // Designed for a single singing/humming voice, not chords.
  function estimatePitch(input, sampleRate) {
    let power = 0;
    for (let i = 0; i < input.length; i++) power += input[i] * input[i];
    const rms = Math.sqrt(power / input.length);
    if (rms < 0.014) return null;

    const stride = 2;
    const rate = sampleRate / stride;
    const minLag = Math.floor(rate / 900);
    const maxLag = Math.min(Math.floor(rate / 80), 430);
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
    return Number.isFinite(frequency) && frequency >= 80 && frequency <= 900 ? frequency : null;
  }

  function getNoteName(frequency) {
    if (!Number.isFinite(frequency) || frequency <= 0) return '—';
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  function setTarget(frequency) {
    if (!Number.isFinite(frequency) || frequency <= 0) return;
    targetFrequency = frequency;
    targetNote.textContent = getNoteName(frequency);
    targetFrequencyLabel.textContent = frequency.toFixed(1) + ' Hz';
    if (!recent.length) {
      needle.style.left = '50%';
      direction.textContent = '目標音に合わせて声を出してください';
    }
  }

  function updateInputLevel(input) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    levelFill.style.width = Math.min(100, Math.round(rms * 550)) + '%';
    return rms;
  }

  function showPitch(frequency) {
    if (frequency === null) {
      recent = [];
      noteLabel.textContent = '—';
      frequencyLabel.textContent = '声を出してください';
      centsLabel.textContent = '— cent';
      needle.style.left = '50%';
      direction.textContent = '音程を検出中';
      return;
    }
    recent.push(frequency);
    if (recent.length > 4) recent.shift();
    const sorted = [...recent].sort((a, b) => a - b);
    const stable = sorted[Math.floor(sorted.length / 2)];
    const deltaCents = Math.round(1200 * Math.log2(stable / targetFrequency));
    noteLabel.textContent = getNoteName(stable);
    frequencyLabel.textContent = stable.toFixed(1) + ' Hz';
    centsLabel.textContent = (deltaCents > 0 ? '+' : '') + deltaCents + ' cent';
    // ±50 cents displayed across a centered meter (6–94%).
    needle.style.left = (50 + Math.max(-50, Math.min(50, deltaCents)) * 0.88) + '%';
    if (Math.abs(deltaCents) <= 8) {
      direction.textContent = '目標音とほぼ一致';
      needle.style.background = '#53c7a9';
    } else if (Math.abs(deltaCents) > 50) {
      direction.textContent = deltaCents < 0 ? '目標音より低い（目盛り範囲外）' : '目標音より高い（目盛り範囲外）';
      needle.style.background = '#fff';
    } else {
      direction.textContent = deltaCents < 0 ? 'もう少し高く' : 'もう少し低く';
      needle.style.background = '#fff';
    }
  }

  function stopGuide() {
    if (guideTimer) clearTimeout(guideTimer);
    guideTimer = 0;
    if (guideOsc) {
      try { guideOsc.stop(); } catch (_) {}
      try { guideOsc.disconnect(); } catch (_) {}
    }
    if (guideGain) { try { guideGain.disconnect(); } catch (_) {} }
    guideOsc = null;
    guideGain = null;
    guideUntil = 0;
    guideButton.disabled = !active;
  }

  async function playGuide() {
    if (!active || !context || guideOsc) return;
    guideButton.disabled = true;
    try {
      if (context.state !== 'running') await context.resume();
      const now = context.currentTime + 0.01;
      guideOsc = context.createOscillator();
      guideGain = context.createGain();
      guideOsc.type = 'sine';
      guideOsc.frequency.setValueAtTime(targetFrequency, now);
      guideGain.gain.setValueAtTime(0, now);
      guideGain.gain.linearRampToValueAtTime(0.095, now + 0.045);
      guideGain.gain.setValueAtTime(0.095, now + 0.52);
      guideGain.gain.linearRampToValueAtTime(0, now + 0.72);
      guideOsc.connect(guideGain);
      guideGain.connect(context.destination);
      guideOsc.start(now);
      guideOsc.stop(now + 0.74);
      guideUntil = performance.now() + 950;
      status.textContent = 'ガイド音を再生中（計測を一時停止）';
      guideTimer = setTimeout(() => {
        stopGuide();
        if (active) status.textContent = 'マイク入力中';
      }, 850);
    } catch (error) {
      stopGuide();
      status.textContent = 'ガイド音を再生できません: ' + (error.message || error.name);
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
        showPitch(null);
        return;
      }
      const pitch = estimatePitch(samples, context.sampleRate);
      showPitch(pitch);
      status.textContent = pitch !== null
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
    recent = [];
    toneButton.disabled = false;
    soundButton.disabled = false;
  }

  async function stop() {
    await releaseDevices();
    panel.hidden = true;
    document.body.classList.remove('voice-mode');
    if (window.kotodamaSetVoiceLabels) window.kotodamaSetVoiceLabels(false);
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
      panel.hidden = false;
      const message = error.name === 'NotAllowedError'
        ? 'マイクが許可されていません。ブラウザー設定を確認してください。'
        : '開始できません: ' + (error.message || error.name);
      status.textContent = message;
      guideButton.disabled = true;
      button.textContent = 'VOICE: START';
    } finally {
      button.disabled = false;
      starting = false;
    }
  }

  button.addEventListener('click', () => { void (active ? stop() : start()); });
  guideButton.addEventListener('click', () => { void playGuide(); });
  sensitivityButton.addEventListener('click', () => {
    sensitivityIndex = (sensitivityIndex + 1) % inputSensitivity.length;
    const value = inputSensitivity[sensitivityIndex];
    sensitivityButton.textContent = '感度 ×' + value;
    if (inputGain) inputGain.gain.value = value;
    recent = [];
    showPitch(null);
    if (active) status.textContent = 'マイク感度 ×' + value + '（感度を上げると雑音も増えます）';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) void stop();
  });
  window.addEventListener('pagehide', () => { if (active || stream) void stop(); });
  window.kotodamaVoiceTuner = { estimatePitch, stop, setTarget, get active() { return active; } };
  if (window.kotodamaGetVoiceTarget) setTarget(window.kotodamaGetVoiceTarget());
})();
