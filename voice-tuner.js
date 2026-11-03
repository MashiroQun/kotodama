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
  if (!button || !panel) return;

  let stream = null, context = null, source = null, analyser = null;
  let samples = null, frameId = 0, lastScan = 0, active = false, starting = false;
  let recent = [];
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

  function showPitch(frequency) {
    if (frequency === null) {
      recent = [];
      noteLabel.textContent = '—';
      frequencyLabel.textContent = '声を出してください';
      centsLabel.textContent = '音程を計測中';
      return;
    }
    recent.push(frequency);
    if (recent.length > 5) recent.shift();
    const sorted = [...recent].sort((a, b) => a - b);
    const stable = sorted[Math.floor(sorted.length / 2)];
    const semitones = 69 + 12 * Math.log2(stable / 440);
    const midi = Math.round(semitones);
    const noteName = NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    const cents = Math.round(100 * (semitones - midi));
    noteLabel.textContent = noteName;
    frequencyLabel.textContent = stable.toFixed(1) + ' Hz';
    centsLabel.textContent = (cents > 0 ? '+' : '') + cents + ' cent';
  }

  function scan(now) {
    if (!active || !analyser) return;
    frameId = requestAnimationFrame(scan);
    if (now - lastScan < 100) return;
    lastScan = now;
    try {
      analyser.getFloatTimeDomainData(samples);
      showPitch(estimatePitch(samples, context.sampleRate));
    } catch (error) {
      status.textContent = '解析エラー: ' + error.message;
      void stop();
    }
  }

  async function releaseDevices() {
    active = false;
    cancelAnimationFrame(frameId);
    frameId = 0;
    if (source) { try { source.disconnect(); } catch (_) {} }
    source = null;
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
    status.textContent = 'マイク未使用';
    button.textContent = 'VOICE: START';
  }

  async function start() {
    if (active || starting) return;
    starting = true;
    button.disabled = true;
    toneButton.disabled = true;
    soundButton.disabled = true;
    status.textContent = 'マイクの許可を確認中…';
    panel.hidden = false;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('HTTPSとマイク対応ブラウザーが必要です');
      }
      // The sound generator is stopped before microphone capture on purpose.
      // Especially important for Safari/iOS echo-cancellation and feedback.
      if (typeof window.kotodamaStopSound === 'function') {
        await window.kotodamaStopSound();
      }
      // stopTuning() re-enables its button on completion.
      toneButton.disabled = true;
      soundButton.disabled = true;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false
      });
      if (document.hidden) throw new Error('画面を表示してから再試行してください');
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Web Audioに対応していません');
      context = new Context();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser); // Never connect to destination: no feedback.
      samples = new Float32Array(analyser.fftSize);
      await context.resume();
      active = true;
      toneButton.disabled = true;
      soundButton.disabled = true;
      button.textContent = 'VOICE: STOP';
      status.textContent = 'マイク入力のみ解析中（録音・送信なし）';
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
      button.textContent = 'VOICE: START';
    } finally {
      button.disabled = false;
      starting = false;
    }
  }

  button.addEventListener('click', () => { void (active ? stop() : start()); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) void stop();
  });
  window.addEventListener('pagehide', () => { if (active || stream) void stop(); });
  window.kotodamaVoiceTuner = { estimatePitch, stop, get active() { return active; } };
})();
