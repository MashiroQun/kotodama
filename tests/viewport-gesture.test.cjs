// node tests/viewport-gesture.test.cjs
// iOS WebKit: allow two-finger pinch recovery, suppress double-tap smart zoom.
// Real Safari / home-screen PWA behavior still needs a device test.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source, 'missing main script');
assert.match(html, /touch-action:\s*manipulation/, 'browser must support pinch zoom');
assert.ok(!/touch-action:\s*none/.test(html), 'do not block pinch on child controls');
assert.ok(!/user-scalable=no|maximum-scale=1/.test(html), 'viewport must remain zoomable');
assert.match(html, /#voice-options \{ display: none; grid-template-columns: repeat\(3,/);
assert.match(html, /#chakra-ring \{[^}]+opacity: 0\.84/);
const first = source.indexOf('    function blockViewportZoom(event) {');
const last = source.indexOf("    window.addEventListener('resize', setFillHeight);", first);
assert.ok(first >= 0 && last > first, 'background double-tap fallback missing');
const listeners = {};
let clock = 1000;
vm.runInNewContext(source.slice(first, last), {
  document: { addEventListener(type, fn) { listeners[type] = fn; } },
  performance: { now() { return clock; } }, Math
});
assert.equal(listeners.gesturestart, undefined, 'pinch start should remain available');
assert.equal(listeners.gesturechange, undefined, 'pinch changes must remain available');
assert.equal(listeners.touchmove, undefined, 'two-finger moves must remain available');
function event({touches=[], changedTouches=[], isControl=false}={}) {
  return {cancelable:true, touches, changedTouches, prevented:false,
    target: {closest(){return isControl ? {} : null;}},
    preventDefault(){this.prevented = true;}};
}
const oneTouch={clientX:130,clientY:150};
const firstTap=event({changedTouches:[oneTouch]});listeners.touchend(firstTap);
clock += 160;
const secondTap=event({changedTouches:[{clientX:132,clientY:152}]});
listeners.touchend(secondTap);assert.equal(secondTap.prevented,true);
const controlTap=event({changedTouches:[oneTouch],isControl:true});listeners.touchend(controlTap);
clock += 140;
const repeatControl=event({changedTouches:[oneTouch],isControl:true});
listeners.touchend(repeatControl);assert.equal(repeatControl.prevented,false);
// A pinch ends with one finger remaining; must not be confused with a double tap.
const pinchEnd=event({touches:[oneTouch],changedTouches:[oneTouch]});
listeners.touchend(pinchEnd);assert.equal(pinchEnd.prevented,false);
console.log('PASS: browser pinch recovery, background double-tap guard, rapid button taps');
