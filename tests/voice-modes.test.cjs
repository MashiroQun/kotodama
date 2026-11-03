// Run with: node tests/voice-modes.test.cjs
// Browser-free UI/audio routing smoke test. iPhone audible playback remains unverified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '..', 'voice-tuner.js'), 'utf8');

(async () => {
  const elements = new Map();
  const frames = [];
  const timers = [];
  const classes = new Set();
  let stoppedTracks = 0, audioPlayCalls = 0, noteIndex = -1;
  let labels = null, wavBlob = null, lastObjectURL = 0;
  function el(id) {
    if (!elements.has(id)) elements.set(id, {
      id, textContent: '', style: {}, disabled: false, hidden: id === 'voice-panel', handlers: {},
      addEventListener(name, cb) { this.handlers[name] = cb; }
    });
    return elements.get(id);
  }
  const document = {
    hidden: false,
    getElementById: el, querySelector() { return el('title-sub'); }, addEventListener() {},
    body: { classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); } } }
  };
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.currentTime = 1; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createAnalyser() { return {
      fftSize: 4096,
      getFloatTimeDomainData(samples) {
        for (let i = 0; i < samples.length; i++) {
          samples[i] = .35 * Math.sin(2 * Math.PI * 220 * i / 48000);
        }
      }
    }; }
    async resume() {}
    async close() {}
  }
  const window = {
    AudioContext: FakeAudioContext,
    addEventListener() {}, kotodamaSoundIsRunning: () => false,
    kotodamaGetVoiceTarget: () => 130.81278265,
    kotodamaSetVoiceLabels(active, notation) { labels = { active, notation }; },
    kotodamaSetVoiceSelection(index) { noteIndex = index; }
  };
  const navigator = {
    audioSession: { type: 'auto' },
    mediaDevices: {
      async getUserMedia() {
        return { getTracks() { return [{ stop() { stoppedTracks++; } }]; } };
      }
    }
  };
  class FakeAudio {
    constructor(url) { this.url = url; }
    play() { audioPlayCalls++; return Promise.resolve(); }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  const URL = {
    createObjectURL(blob) { wavBlob = blob; lastObjectURL++; return 'blob:guide'; },
    revokeObjectURL() { lastObjectURL--; }
  };
  const sandbox = {
    document, window, navigator, Audio: FakeAudio, URL, Blob,
    Float32Array, ArrayBuffer, DataView, Math, Number, console,
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
    performance: { now: () => 1000 }
  };
  vm.runInNewContext(script, sandbox, { filename: 'voice-tuner.js' });
  const engine = window.kotodamaVoiceTuner;
  assert.equal(engine.mode, 'free');
  assert.equal(engine.response, '安定');
  assert.equal(labels, null, 'initial load must not relabel meditation buttons');

  el('btn-voice').handlers.click();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(engine.active, true);
  assert.equal(classes.has('voice-mode'), true);
  assert.equal(el('btn-voice-octave').disabled, true);
  el('btn-voice-smoothing').handlers.click();
  assert.equal(engine.response, '敏感');
  el('btn-voice-smoothing').handlers.click();
  assert.equal(engine.response, '標準');
  el('btn-voice-smoothing').handlers.click();
  assert.equal(engine.response, '安定');
  assert.equal(el('btn-mic-gain').textContent, '', 'response must not touch input gain');
  assert.equal(labels.notation, 'solfege');
  frames.shift()(1100);
  assert.equal(el('voice-note').textContent, 'ラ3');
  assert.equal(el('voice-note').style.webkitTextStrokeColor, '#7896FF',
    'A3 should have a blue outline');
  assert.equal(el('voice-target-note').textContent, 'ラ3');
  assert.equal(noteIndex, 5);
  assert.equal(el('btn-guide').disabled, true, 'guide is unavailable in free mode');
  assert.equal(el('btn-guide').textContent, 'ガイド: 目標音のみ');
  // Even a synthetic click on the disabled button must not trigger audio.
  el('btn-guide').handlers.click();
  assert.equal(audioPlayCalls, 0);

  el('btn-voice-notation').handlers.click();
  assert.equal(el('voice-note').textContent, 'A3');
  el('btn-voice-mode').handlers.click();
  assert.equal(engine.mode, 'target');
  assert.equal(el('voice-target-note').textContent, 'C3');
  assert.equal(el('btn-voice-octave').disabled, false);
  assert.equal(el('btn-guide').disabled, false, 'target guide should be available');
  el('btn-voice-octave').handlers.click();
  assert.equal(el('voice-target-note').textContent, 'C2');

  el('btn-guide').handlers.click();
  assert.equal(audioPlayCalls, 1);
  assert.equal(navigator.audioSession.type, 'playback');
  assert.ok(wavBlob.size > 20000);
  assert.equal(lastObjectURL, 1);
  timers.find(t => t.delay === 1080).fn();
  assert.equal(navigator.audioSession.type, 'auto');
  assert.equal(lastObjectURL, 0);

  el('btn-voice').handlers.click();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(engine.active, false);
  assert.equal(classes.has('voice-mode'), false);
  assert.equal(stoppedTracks, 1);
  assert.equal(labels.active, false);
  console.log('PASS: free guide disabled, target guide enabled, octave, solfege/letters, guide WAV & session restore');
})().catch(e => { console.error(e); process.exitCode = 1; });
