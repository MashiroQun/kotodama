/*
 * Kotodama PWA update manager.
 * UI follows Rin Player: checking / new version / latest / error / apply.
 * VitePWA builds the Workbox sw.js; one registration is explicitly shared
 * between startup and the UPDATE button to avoid a first-run race.
 */
(() => {
  'use strict';

  const modal = document.getElementById('update-modal');
  const icon = document.getElementById('update-modal-icon');
  const title = document.getElementById('update-modal-title');
  const message = document.getElementById('update-modal-message');
  const actions = document.getElementById('update-modal-actions');
  const closeButton = document.getElementById('update-button-close');
  const applyButton = document.getElementById('update-button-apply');

  if (!modal || !icon || !title || !message || !actions || !closeButton || !applyButton) return;

  let registration = null;
  let registerPromise = null;
  let pendingWorker = null;
  let checking = false;
  let applying = false;
  let alreadyReloading = false;
  let hadController = !!navigator.serviceWorker?.controller;
  let startupCheck = false;
  let updateRequestId = 0;
  let currentState = '';
  const watchedWorkers = new WeakSet();
  const watchedRegistrations = new WeakSet();

  const CONTENT = {
    checking: ['確認中...', '最新版を確認しています。', '⟳', null],
    available: ['新しいバージョンがあります', '更新の準備ができました。今すぐ更新しますか？', '↻', 'apply'],
    latest: ['最新版です', '現在のアプリは最新の状態です。', '✓', 'close'],
    preparing: ['更新を準備中です', '新しいデータを取得しています。しばらくしてからもう一度確認してください。', '↻', 'close'],
    applying: ['更新しています...', 'アプリを新しいバージョンに切り替えています。', '⟳', null],
    error: ['更新を確認できませんでした', '通信状態を確認し、もう一度お試しください。', '!', 'close'],
    unsupported: ['更新を確認できません', 'このブラウザーではサービスワーカーを利用できません。', '!', 'close'],
    installing: ['更新機能を準備中です', '初回起動のため、アプリの更新機能を登録しています。少ししてから再度確認してください。', '↻', 'close'],
    stalled: ['更新の反映を待っています', 'アプリをいったん終了して開き直すと、更新される場合があります。', '↻', 'close']
  };

  function showUpdateModal(state, overrideMessage = null) {
    const entry = CONTENT[state] || CONTENT.error;
    currentState = state;
    title.textContent = entry[0];
    message.textContent = overrideMessage || entry[1];
    icon.classList.toggle('checking', state === 'checking' || state === 'applying');
    icon.textContent = state === 'checking' || state === 'applying' ? '' : entry[2];
    actions.hidden = entry[3] === null;
    closeButton.hidden = entry[3] === null;
    applyButton.hidden = entry[3] !== 'apply';
    closeButton.textContent = state === 'available' ? 'あとで' : 'OK';
    modal.hidden = false;
  }

  function closeUpdateModal() {
    if (applying) return;
    modal.hidden = true;
    updateRequestId++; // stop pending checks from reopening a dismissed modal
    checking = false;
  }

  function playbackIsBusy() {
    return !!(window.kotodamaSoundIsRunning?.() || window.kotodamaVoiceTuner?.active);
  }

  function getWaitingWorker(reg) {
    if (!reg || !navigator.serviceWorker?.controller) return null;
    const worker = reg.waiting || pendingWorker;
    if (worker && worker.state === 'installed') return worker;
    return null;
  }

  function activateWaitingWorker(reg, silent = false) {
    const worker = getWaitingWorker(reg);
    if (!worker || applying) return false;
    applying = true;
    checking = false;
    if (!silent) showUpdateModal('applying');
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
      // WebKit may defer controlling until a navigation; don't claim success
      // without a controllerchange event.
      setTimeout(() => {
        if (applying && !alreadyReloading) {
          applying = false;
          if (worker.state === 'activated') {
            window.location.reload();
          } else {
            showUpdateModal('stalled');
          }
        }
      }, 7000);
    } catch (error) {
      applying = false;
      showUpdateModal('error');
      console.warn('Unable to activate new worker:', error);
      return false;
    }
    return true;
  }

  function onWorkerInstalled(reg, worker) {
    if (!navigator.serviceWorker?.controller) return; // first installation, not an upgrade
    pendingWorker = reg.waiting || worker;
    if (startupCheck && !checking && !playbackIsBusy()) {
      activateWaitingWorker(reg, true);
    } else if (checking || (!modal.hidden &&
               (currentState === 'preparing' || currentState === 'latest'))) {
      // If installation finishes late, replace any premature "latest" result.
      showUpdateModal('available');
    }
  }

  function watchWorker(reg, worker) {
    if (!worker || watchedWorkers.has(worker)) return;
    watchedWorkers.add(worker);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') onWorkerInstalled(reg, worker);
      if (worker.state === 'redundant' && pendingWorker === worker) pendingWorker = null;
    });
    if (worker.state === 'installed') onWorkerInstalled(reg, worker);
  }

  function watchRegistration(reg) {
    if (!reg) return;
    registration = reg;
    if (watchedRegistrations.has(reg)) return;
    watchedRegistrations.add(reg);
    watchWorker(reg, reg.installing);
    reg.addEventListener('updatefound', () => {
      watchWorker(reg, reg.installing);
    });
    if (reg.waiting && navigator.serviceWorker?.controller) {
      pendingWorker = reg.waiting;
    }
  }

  function ensureRegistration() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (registration) return Promise.resolve(registration);
    if (!registerPromise) {
      // No competing injected registerSW.js script. register() resolves even on
      // the very first visit when getRegistration() would still return null.
      registerPromise = navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none'
      }).then(reg => {
        watchRegistration(reg);
        return reg;
      }).catch(error => {
        registerPromise = null; // allow retry after a transient network error
        throw error;
      });
    }
    return registerPromise;
  }

  async function checkForUpdate() {
    if (checking || applying) return;
    const requestId = ++updateRequestId;
    if (!('serviceWorker' in navigator)) {
      showUpdateModal('unsupported');
      return;
    }
    checking = true;
    showUpdateModal('checking');
    try {
      const reg = await ensureRegistration();
      if (!reg) {
        if (requestId === updateRequestId) showUpdateModal('unsupported');
        return;
      }

      if (!getWaitingWorker(reg) && reg.active) {
        await reg.update();
        if (!getWaitingWorker(reg)) {
          await new Promise(resolve => setTimeout(resolve, 3500));
        }
      }

      if (requestId !== updateRequestId) return;
      if (getWaitingWorker(reg)) {
        showUpdateModal('available');
      } else if (!reg.active) {
        showUpdateModal('installing');
      } else if (reg.installing) {
        showUpdateModal('preparing');
      } else {
        showUpdateModal('latest');
      }
    } catch (error) {
      if (requestId === updateRequestId) showUpdateModal('error');
      console.warn('Update check failed:', error);
    } finally {
      if (requestId === updateRequestId) checking = false;
    }
  }

  function applyUpdate() {
    if (applying) return;
    const reg = registration;
    if (!reg || !activateWaitingWorker(reg)) {
      showUpdateModal('error', '更新データが準備できていません。もう一度確認してください。');
    }
  }

  closeButton.addEventListener('click', closeUpdateModal);
  applyButton.addEventListener('click', applyUpdate);
  modal.addEventListener('click', event => {
    if (event.target === modal && !applying) closeUpdateModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden && !applying) closeUpdateModal();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const shouldReload = hadController || applying;
      hadController = true;
      if (shouldReload && !alreadyReloading) {
        alreadyReloading = true;
        window.location.reload();
      }
    });

    window.addEventListener('load', () => {
      // Rin-style automatic update upon fresh opening, but never interrupt
      // an already-running tuner. Changes found later remain pending.
      startupCheck = true;
      setTimeout(() => { startupCheck = false; }, 6000);
      ensureRegistration().then(async reg => {
        if (!reg) return;
        if (getWaitingWorker(reg) && !playbackIsBusy()) {
          activateWaitingWorker(reg, true);
          return;
        }
        try {
          if (reg.active) await reg.update();
        } catch (error) {
          console.warn('Startup update check unavailable:', error);
        }
      }).catch(error => console.warn('PWA registration unavailable:', error));
    });
  }

  // The existing inline UPDATE button calls this global function.
  window.checkForUpdate = checkForUpdate;
  window.applyUpdate = applyUpdate;
  window.closeUpdateModal = closeUpdateModal;
})();