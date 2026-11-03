// node tests/audio-session.test.cjs
// Browser-free lifecycle regression: does NOT replace iOS audio playback testing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inline = markup.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline, 'index.html inline script missing');

function takeFunction(name) {
  const match = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{').exec(inline);
  assert.ok(match, 'missing ' + name);
  const start = match.index;
  let depth = 0;
  for (let i = start + match[0].length - 1; i < inline.length; i++) {
    if (inline[i] === '{') depth++;
    if (inline[i] === '}') depth--;
    if (depth === 0) return inline.slice(start, i + 1);
  }
  throw new Error('unbalanced function ' + name);
}
const definitions = ['initAudio', 'disposeAudioChain', 'makePadBuffer', 'createOsc', 'destroyOsc']
  .map(takeFunction).join('\n');
const nodes = [];
function makeNode(type) {
  const node = {
    type, disposed: 0, started: 0, stopped: 0,
    gain: { value: 0, rampTo() {} },
    volume: { value: 0, rampTo() {} },
    frequency: { rampTo() {} },
    toDestination() { return this; },
    connect() { return this; },
    start() { this.started++; return this; },
    stop() { this.stopped++; return this; },
    dispose() { this.disposed++; return this; }
  };
  nodes.push(node);
  return node;
}
const Tone = {
  context: { lookAhead: 0, latencyHint: '', sampleRate: 48000 },
  getContext() {
    return { rawContext: {
      sampleRate: 48000,
      createBuffer(_channels, length) {
        return { getChannelData() { return new Float32Array(length); } };
      }
    } };
  }
};
for (const type of ['Volume','Limiter','Gain','Freeverb','PingPongDelay',
  'Filter','AmplitudeEnvelope','Oscillator','Player']) {
  Tone[type] = class { constructor() { return makeNode(type); } };
}
const harness = new Function('Tone', 'getTargetVolume', [
  'let limiter, reverb, delay, lpf, hpf, env, sessionVolume;',
  'let audioInitialized = false, osc = null, samplePlayer = null;',
  'let dryGain = null, padBuffer = null, soundModeIndex = 0;',
  definitions,
  'return { cycle(mode) {',
  '  soundModeIndex = mode;',
  '  initAudio(); createOsc(220);',
  '  assertState(audioInitialized, [osc, samplePlayer].filter(Boolean).length);',
  '  destroyOsc(); disposeAudioChain();',
  '  return {initialized: audioInitialized, sources: [osc,samplePlayer].filter(Boolean).length, isolated: sessionVolume === null};',
  '} };',
  'function assertState(initialized, sources) { if (!initialized || sources !== 1) throw new Error("invalid session"); }'
].join('\n'))(Tone, () => -3);

const modes = [0, 1, 2, 0, 2, 1, 0]; // deliberately cross mode boundaries
for (const mode of modes) {
  const after = harness.cycle(mode);
  assert.deepEqual(after, {initialized: false, sources: 0, isolated: true});
}
assert.ok(nodes.length > 0);
assert.ok(nodes.every(n => n.disposed === 1), 'leftover or double-disposed nodes');
assert.equal(nodes.filter(n => ['Oscillator','Player'].includes(n.type)).length, modes.length);
console.log('PASS: ' + modes.length + ' playback cycles, ' + nodes.length + ' nodes disposed exactly once (mock)');
