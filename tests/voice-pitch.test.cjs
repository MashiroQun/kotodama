// node tests/voice-pitch.test.cjs
// No dependencies and no microphone required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const elements = new Map();
function getElementById(id) {
  if (!elements.has(id)) {
    elements.set(id, { hidden: false, disabled: false, textContent: '', addEventListener() {} });
  }
  return elements.get(id);
}
const windowMock = { addEventListener() {} };
const context = {
  document: { getElementById, addEventListener() {}, hidden: false },
  window: windowMock,
  Float32Array, Math, Number, console
};
const script = fs.readFileSync(path.join(__dirname, '..', 'voice-tuner.js'), 'utf8');
vm.runInNewContext(script, context, { filename: 'voice-tuner.js' });
const detect = windowMock.kotodamaVoiceTuner.estimatePitch;
const pitches = [82.4, 110, 130.8128, 146.832, 196, 220, 261.6256, 440, 523.251, 880];

for (const sr of [44100, 48000]) {
  for (const f of pitches) {
    const data = Float32Array.from({ length: 4096 }, (_, i) =>
      0.3 * Math.sin(2 * Math.PI * f * i / sr)
    );
    const estimate = detect(data, sr);
    const errorCents = 1200 * Math.log2(estimate / f);
    assert.ok(Number.isFinite(estimate) && Math.abs(errorCents) < 15,
      'incorrect pitch ' + f + ' Hz at ' + sr + ' Hz: ' + estimate);
  }
  const richVoice = Float32Array.from({ length: 4096 }, (_, i) => {
    const t = i / sr;
    return 0.2 * (Math.sin(2*Math.PI*220*t) +
      0.8*Math.sin(2*Math.PI*440*t) + 0.4*Math.sin(2*Math.PI*660*t));
  });
  assert.ok(Math.abs(1200*Math.log2(detect(richVoice, sr)/220)) < 15);
  assert.equal(detect(new Float32Array(4096), sr), null);
}
for (const sr of [44100, 48000]) {
  const frequency = 220;
  const quiet = Float32Array.from({ length: 4096 }, (_, i) =>
    0.005 * Math.sin(2 * Math.PI * frequency * i / sr)
  );
  assert.equal(detect(quiet, sr), null, 'low-level signal should be gated at 1x');
  const boosted = Float32Array.from(quiet, x => x * 8);
  assert.ok(Math.abs(1200 * Math.log2(detect(boosted, sr) / frequency)) < 15,
    '8x boost should recover low-level 220Hz signal');
}
console.log('PASS: 28 voice pitch cases (44.1/48kHz; sine, harmonics, silence, low-level microphone gain)');
