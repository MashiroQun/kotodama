// Run with: node tests/voice-response.test.cjs
// Extracts the actual pitch-stabilization functions rather than duplicating the formula.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'voice-tuner.js'), 'utf8');
const settings = source.match(/const RESPONSE_MODES = \[[\s\S]*?\n  \];/)?.[0];
assert.ok(settings, 'response mode settings missing');
assert.match(source, /let responseIndex = 2/, 'stable must be the default tracking setting');
function take(name) {
  const match = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{').exec(source);
  assert.ok(match, 'missing function ' + name);
  let depth = 0;
  for (let i = match.index + match[0].length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error('Unbalanced ' + name);
}
const factory = new Function([
  settings,
  'let recent=[],responseIndex=1,smoothedMidi=null,selectedMidi=null,lastSmoothAt=0,lastGoodPitchAt=0;',
  ...['freqToMidi','midiToFreq','resetPitchFilter','stabilizePitch'].map(take),
  'return { sample: (hz,t) => stabilizePitch(hz,t), mode: i => responseIndex=i, reset: () => resetPitchFilter() };'
].join('\n'));

const result = [];
for (let mode = 0; mode < 3; mode++) {
  const tracker = factory();
  tracker.mode(mode);
  const output = [];
  let time = 1000;
  for (const hz of [220,220,221,218.5,223,219,222,221,220,220,220,
                    246.94,246.94,246.94,246.94,246.94,246.94]) {
    output.push(tracker.sample(hz, time));
    time += 75;
  }
  assert.equal(output[0].noteMidi, 57, 'A3 must be detected immediately');
  const jitter = output.slice(2, 10)
    .map(v => Math.abs(1200 * Math.log2(v.frequency / 220)));
  result.push({
    jitterAverage: jitter.reduce((a,b) => a+b, 0) / jitter.length,
    jumpAt3: output[13].frequency
  });
}
assert.ok(result[0].jitterAverage > result[1].jitterAverage,
  'standard must settle more than sensitive mode');
assert.ok(result[1].jitterAverage > result[2].jitterAverage,
  'stable must settle more than standard mode');
assert.ok(result[0].jumpAt3 > result[1].jumpAt3 &&
          result[1].jumpAt3 > result[2].jumpAt3,
  'higher stability must follow a note transition more slowly');

const tracker = factory();
tracker.sample(440, 1000); // establish A4 before crossing the semitone border
for (let t=1075; t<1600; t+=75) {
  tracker.sample(440 * Math.pow(2, 0.51/12), t);
}
assert.equal(tracker.sample(440 * Math.pow(2, 0.51/12), 1600).noteMidi, 69,
  'standard note hysteresis must not flicker at 51 cents above A4');
tracker.reset();
assert.equal(tracker.sample(220, 2000).noteMidi, 57, 'reset must recover instantly');
assert.match(source, /let sensitivityIndex = 2/, '8x mic gain default must remain');
console.log('PASS: selectable pitch smoothing, note hysteresis, reset, independent 8x microphone gain');
