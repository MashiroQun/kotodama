// Run: node tests/pwa-update.test.cjs
// Browser-free simulation: real Safari PWA / service-worker lifecycle still needs a device check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '..', 'pwa-update.js'), 'utf8');

function simulate({ waiting = false, updateFails = false, hasSW = true, installing = false } = {}) {
  const ui = new Map(), timers = [], posted = [];
  let checks = 0, reloads = 0;
  function element(id) {
    if (!ui.has(id)) ui.set(id, {
      hidden: true, textContent: '',
      events: {}, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, handler) { this.events[type] = handler; }
    });
    return ui.get(id);
  }
  function emitter() {
    return {
      events: {},
      addEventListener(type, handler) {
        if (!this.events[type]) this.events[type] = [];
        this.events[type].push(handler);
      },
      trigger(type) { for (const fn of this.events[type] || []) fn(); }
    };
  }
  const worker = Object.assign(emitter(), {
    state: waiting ? 'installed' : 'installing',
    postMessage(value) { posted.push(value); }
  });
  const registration = Object.assign(emitter(), {
    waiting: waiting ? worker : null,
    installing: installing ? worker : null,
    async update() { checks++; if (updateFails) throw new Error('network failure'); }
  });
  const serviceWorker = Object.assign(emitter(), {
    controller: {},
    ready: Promise.resolve(registration),
    async getRegistration() { return registration; }
  });
  const navigator = hasSW ? { serviceWorker } : {};
  const window = Object.assign(emitter(), {
    location: { reload() { reloads++; } },
    kotodamaSoundIsRunning: () => false
  });
  vm.runInNewContext(script, {
    document: { getElementById: element, addEventListener() {} },
    navigator, window,
    console: { warn() {} },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    WeakSet
  });
  return {
    window, navigator, registration, worker, posted,
    element,
    get checks() { return checks; },
    get reloads() { return reloads; },
    flush(delay) { for (const timer of timers.filter(t => t.delay === delay)) timer.fn(); },
    async microtasks() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  };
}

(async () => {
  let x = simulate({ hasSW: false });
  await x.window.checkForUpdate();
  assert.equal(x.element('update-modal-title').textContent, '更新を確認できません');

  x = simulate({ waiting: true });
  await x.window.checkForUpdate();
  assert.equal(x.element('update-modal-title').textContent, '新しいバージョンがあります');
  assert.equal(x.element('update-button-apply').hidden, false);
  x.window.applyUpdate();
  assert.equal(x.posted.length, 1);
  assert.equal(x.posted[0].type, 'SKIP_WAITING');
  x.navigator.serviceWorker.trigger('controllerchange');
  x.navigator.serviceWorker.trigger('controllerchange');
  assert.equal(x.reloads, 1, 'must reload at most once');

  x = simulate({ waiting: true });
  x.window.trigger('load');
  await x.microtasks();
  assert.equal(x.posted.length, 1, 'waiting update applies on launch');

  x = simulate();
  const latestCheck = x.window.checkForUpdate();
  await x.microtasks();
  x.flush(3500);
  await latestCheck;
  assert.equal(x.element('update-modal-title').textContent, '最新版です');
  assert.equal(x.checks, 1);

  x = simulate({ updateFails: true });
  await x.window.checkForUpdate();
  assert.equal(x.element('update-modal-title').textContent, '更新を確認できませんでした');

  x = simulate({ installing: true });
  const slowCheck = x.window.checkForUpdate();
  await x.microtasks();
  x.flush(3500);
  await slowCheck;
  assert.equal(x.element('update-modal-title').textContent, '更新を準備中です');
  x.registration.waiting = x.worker;
  x.worker.state = 'installed';
  x.worker.trigger('statechange');
  assert.equal(x.element('update-modal-title').textContent, '新しいバージョンがあります');

  console.log('PASS: unsupported, pending/apply, startup apply, latest, error, installing->available');
})().catch(error => { console.error(error); process.exitCode = 1; });
