// node tests/voice-input-gate.test.cjs
// Regression for quiet voice pickup: do not gate the detected note again.
// UI-only smoothing is covered separately below.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'voice-tuner.js'), 'utf8');

assert.ok(!source.includes('MIN_VOICE_RMS'), 'do not reinstate a higher noise gate');
assert.ok(!source.includes('acceptVoicePitch'), 'do not require a second confirmed onset frame');
assert.ok(!source.includes('noiseFloorRms'), 'do not learn a floor that hides weak voices');
assert.match(source, /const pitch = estimatePitch\(samples, context\.sampleRate\);/,
  'each audio frame should reach the original pitch detector');
assert.match(source, /const inputSensitivity = \[4, 8, 32\]/);
assert.match(source, /let sensitivityIndex = 1/);
assert.match(source, /let responseIndex = 2/);

function extract(name) {
  const start = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{').exec(source);
  assert.ok(start, 'missing function ' + name);
  let depth = 0;
  for (let i = start.index + start[0].length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (!depth) return source.slice(start.index, i + 1);
  }
  throw new Error('Unbalanced ' + name);
}
const estimate = new Function(extract('estimatePitch') + '\nreturn estimatePitch;')();
for (const sampleRate of [44100, 48000]) {
  // RMS≈0.017, above the original 0.014 detector floor but below the
  // previously added 0.028 noise gate. Must be recognized immediately.
  const weakVoice = Float32Array.from({ length: 4096 }, (_, i) =>
    0.024 * Math.sin(2 * Math.PI * 220 * i / sampleRate));
  const hz = estimate(weakVoice, sampleRate);
  assert.ok(Number.isFinite(hz) && Math.abs(1200 * Math.log2(hz / 220)) < 15,
    'quiet 220 Hz singing should be detected on the first frame');
}

const stable = new Function([
  'let visualCents=null,visualCentsAt=0,visualTargetMidi=null,responseIndex=2;',
  extract('freqToMidi'), extract('stableDisplayedCents'),
  'return (c,f,t) => stableDisplayedCents(c,f,t);'
].join('\n'))();
assert.equal(stable(0, 220, 1000), 0);
const slightMove = stable(24, 220, 1075);
assert.ok(slightMove > 0 && slightMove < 24,
  'a moving pitch should move the display more gently');
assert.equal(slightMove % 2, 0, 'cents display moves in readable 2-cent steps');
const noteSwitch = stable(12, 246.94, 1150);
assert.equal(noteSwitch, 12, 'new target notes should not drag the previous needle position');
console.log('PASS: weak first-frame detection restored; display smoothing remains independent');
