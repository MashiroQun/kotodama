// node tests/audio-session.test.cjs
// Real source-function extraction + mocks. Physical iOS audio requires device testing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'inline app script missing');
function extract(name) {
  const m = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{').exec(source);
  assert.ok(m, 'missing audio function '+name);
  const from = m.index;
  let depth = 0;
  for (let i = from + m[0].length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(from, i + 1);
  }
  throw new Error('unbalanced function: ' + name);
}
const functions = ['initAudio','disposeAudioChain','makePadBuffer','setPadPitch','createOsc','destroyOsc']
  .map(extract).join('\n');
const stopSection = source.slice(source.indexOf('    async function stopTuning()'),
  source.indexOf('    async function toggleTuning()'));
assert.match(stopSection, /renderer\.clear\(\)/, 'GPU context should be reusable after a stop');
assert.ok(!stopSection.includes('renderer.dispose()'), 'GPU recreation on every switch is too costly');
assert.match(source, /Tone\.context\.lookAhead = 0\.035/, 'schedule with some headroom');
assert.match(source, /padPitchTimer = setTimeout/, 'pad note changes must be gain-gated');

const nodes = [];
function node(type) {
  const n = {
    type, disposed: 0, started: 0, stopped: 0,
    gain: {value:0, actions:[], rampTo(value,time){this.value=value;this.actions.push({value,time});}},
    volume:{value:0, rampTo(){}},
    frequency:{rampTo(){}},
    toDestination(){return this;},connect(){return this;},
    start(){this.started++;return this;},stop(){this.stopped++;return this;},
    dispose(){this.disposed++;return this;}
  };
  nodes.push(n);
  return n;
}
const Tone = {
  context:{lookAhead:0, latencyHint:'', sampleRate:48000},
  getContext() { return {rawContext:{
    sampleRate:48000,
    createBuffer(_channels,len){return{getChannelData(){return new Float32Array(len)}}}
  }}; }
};
for (const name of ['Volume','Limiter','Gain','Freeverb','PingPongDelay','Filter',
                    'AmplitudeEnvelope','Oscillator','Player']) {
  Tone[name] = class { constructor(){return node(name)} };
}
const timers = new Map();
let nextId=0;
function delayed(fn) {const id=++nextId;timers.set(id,fn);return id}
function cancel(id){timers.delete(id)}
function flush(){const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn())}
const harness=new Function('Tone','getTargetVolume','setTimeout','clearTimeout', [
  "let limiter,reverb,delay,lpf,hpf,env,sessionVolume;",
  "let audioInitialized=false,osc=null,samplePlayer=null;",
  "let dryGain=null,padBuffer=null,padPitchTimer=null,soundModeIndex=0;",
  "let isTuning=true,isStopping=false;",
  functions,
  "return {",
  "  cycle(mode){",
  "    soundModeIndex=mode;initAudio();createOsc(220);",
  "    if (!audioInitialized || [osc,samplePlayer].filter(Boolean).length!==1) throw Error('wrong active source count');",
  "    destroyOsc();disposeAudioChain();",
  "    return {initialized:audioInitialized, active:[osc,samplePlayer].filter(Boolean).length, isolated:sessionVolume===null};",
  "  },",
  "  pad(){ soundModeIndex=2;initAudio();createOsc(220); return{player:samplePlayer,gain:dryGain.gain}; },",
  "  shift(rate){setPadPitch(rate)},",
  "  stop(){destroyOsc();disposeAudioChain()}",
  "};"
].join('\n'))(Tone,()=>-3,delayed,cancel);
const modes=[0,1,2,0,2,1,0];
for (const mode of modes) {
  const state=harness.cycle(mode);
  assert.deepEqual(state,{initialized:false,active:0,isolated:true});
}
assert.ok(nodes.every(n=>n.disposed===1), 'no audio node leaks');
assert.equal(nodes.filter(n=>n.type==='Oscillator'||n.type==='Player').length,modes.length);
const pad=harness.pad();
harness.shift(1.5);
assert.equal(pad.gain.actions.at(-1).value,0.12, 'first duck the audio gain');
assert.equal(timers.size,1, 'shift must wait until fade has started');
assert.equal(pad.player.playbackRate,1, 'rate stays unchanged until duck');
flush();
assert.equal(pad.player.playbackRate,1.5, 'rate switches after the gain is reduced');
assert.equal(pad.gain.actions.at(-1).value,1, 'gain rises after rate change');
harness.shift(2);
assert.equal(timers.size,1);
harness.stop();
assert.equal(timers.size,0, 'stop must cancel pending shift timer');
assert.ok(nodes.every(n=>n.disposed===1), 'all repeated sources cleaned exactly once');
console.log('PASS: 7 audio cycles, pad pitch duck/restore, no pending shift after stop, GPU reuse');
