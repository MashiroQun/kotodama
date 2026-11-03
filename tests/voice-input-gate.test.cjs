// node tests/voice-input-gate.test.cjs
// Verify the actual input-gating functions without a microphone or browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'voice-tuner.js'), 'utf8');

function extract(name) {
  const found = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{').exec(source);
  assert.ok(found, 'missing ' + name);
  let depth=0;
  for(let i=found.index+found[0].length-1;i<source.length;i++){
    if(source[i]==='{') depth++;
    if(source[i]==='}') depth--;
    if(depth===0) return source.slice(found.index,i+1);
  }
  throw new Error('unbalanced '+name);
}
const makeGate = new Function([
  'const MIN_VOICE_RMS = 0.028;',
  'let noiseFloorRms=0, onsetPitchHz=null, onsetFrames=0;',
  extract('resetVoiceInputGate'), extract('acceptVoicePitch'),
  'return {test:(rms,hz)=>acceptVoicePitch(rms,hz), reset:resetVoiceInputGate, floor:()=>noiseFloorRms};'
].join('\n'));

const gate = makeGate();
assert.equal(gate.test(.018, 220), null, 'quiet but tonal noise should be rejected');
assert.equal(gate.test(.046, 220), null, 'first pitch frame is not enough');
assert.equal(gate.test(.046, 220), 220, 'second consistent frame confirms the voice');
assert.equal(gate.test(.046, 294), null, 'sudden unrelated pitch needs a new onset');
assert.equal(gate.test(.046, 294), 294, 'new note accepted once confirmed');
assert.equal(gate.test(.008, null), null, 'silence clears the onset');
assert.equal(gate.test(.046, 294), null, 'after silence the onset starts again');
assert.equal(gate.test(.046, 294), 294, 'a real sustained note can re-enter');
gate.reset();
assert.equal(gate.floor(),0,'gain switch resets learned noise floor');

// Ambient broadband noise builds an adaptive floor without a pitched signal.
for (let i=0; i<26; i++) gate.test(.033, null);
assert.ok(gate.floor() > .025 && gate.floor() < .035, 'should learn modest ambient noise');
assert.equal(gate.test(.045, 220), null, 'noise-relative gate prevents weak false tone');
assert.equal(gate.test(.11, 220), null, 'loud onset still needs confirmation');
assert.equal(gate.test(.11, 220), 220, 'loud sustained voice must pass adaptive gate');
assert.match(source,/const inputSensitivity = \[4, 8, 32\]/,'keep AirPods/iPad gains');
assert.match(source,/let sensitivityIndex = 1/,'keep 8x initial gain');
assert.match(source,/let responseIndex = 2/,'keep stable pitch tracking default');
console.log('PASS: weak noise, two-frame onset, note change, silence reset, adaptive ambient noise, 4/8/32x gain');
