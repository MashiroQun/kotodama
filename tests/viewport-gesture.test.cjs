// node tests/viewport-gesture.test.cjs
// Static+event regression checks; physical iOS Safari behavior requires real-device testing.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'missing main script');
const first = source.indexOf('    function blockViewportZoom(event) {');
const last = source.indexOf("    window.addEventListener('resize', setFillHeight);", first);
assert.ok(first >= 0 && last > first, 'zoom prevention listeners missing');
assert.match(html, /touch-action:\s*none/);
assert.match(html, /#voice-options \{ display: none; grid-template-columns: repeat\(3,/);
assert.match(html, /#chakra-ring \{[^}]+opacity: 0\.84/);
const listeners = {};
let clock = 1000;
vm.runInNewContext(source.slice(first, last), {
  document: { addEventListener(type, fn) { listeners[type] = fn; } },
  performance: { now() { return clock; } }, Math
});
function event({touches=[], changedTouches=[], isControl=false}={}) {
  return {cancelable:true, touches, changedTouches, prevented:false,
    target: {closest(){return isControl ? {} : null;}},
    preventDefault(){this.prevented = true;}};
}
const gs = event(); listeners.gesturestart(gs); assert.equal(gs.prevented, true);
const gc = event(); listeners.gesturechange(gc); assert.equal(gc.prevented, true);
const tm = event({touches:[{},{}]}); listeners.touchmove(tm); assert.equal(tm.prevented,true);
const oneTouch={clientX:130,clientY:150};
const firstTap=event({changedTouches:[oneTouch]});listeners.touchend(firstTap);
clock += 160;
const secondTap=event({changedTouches:[{clientX:132,clientY:152}]});
listeners.touchend(secondTap);assert.equal(secondTap.prevented,true);
const controlTap=event({changedTouches:[oneTouch],isControl:true});listeners.touchend(controlTap);
clock += 140;
const repeatControl=event({changedTouches:[oneTouch],isControl:true});
listeners.touchend(repeatControl);assert.equal(repeatControl.prevented,false);
console.log('PASS: gesture zoom suppression and repeatable button taps (event mock)');
