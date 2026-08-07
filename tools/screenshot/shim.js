'use strict';
// Fake extension host for screenshotting the popup outside a browser extension.
//
// Loaded FIRST, before any of the real popup scripts, so `chrome` exists by the
// time they run. Nothing in extension/ is modified: make_harness.py injects this
// into a generated copy of popup.html, and the generated copy loads the REAL
// popup.js / popup.css / sparkline-core.js / content.js. If the product changes,
// the screenshots change with it, because there is no second copy of the code.
//
// Surface implemented is exactly what popup.js touches, no more:
//   chrome.storage.local get/set/remove, chrome.storage.onChanged,
//   chrome.runtime.sendMessage + lastError, chrome.tabs.query/create,
//   chrome.permissions.request
//
// Scenario comes from the query string, so one harness produces every shot:
//   ?coin=BTC&pro=1&theme=dark&panel=methodology
(function () {
  const qs = new URLSearchParams(location.search);
  const cfg = {
    coin:  qs.get('coin')  || null,          // which coin to show first
    pro:   qs.get('pro') === '1',
    theme: qs.get('theme') || 'dark',
    panel: qs.get('panel') || '',            // onboarding | methodology | sites | privacy | picker
    tf:    qs.get('tf')    || '',            // cycle | day | week
    alerts: qs.get('alerts') === '1',
    sort:  qs.get('sort')  || '',            // busiest | alpha, for the picker
    // detect=1 puts the coin on the "current page" WITHOUT tracking it, which is
    // what triggers the teaser card ("Add X to your tracked coins"). That is the
    // coin-detection screenshot.
    detect: qs.get('detect') === '1',
  };
  window.__SHOT_CFG = cfg;

  const payload = window.__PAYLOAD__;        // injected by make_harness.py
  if (!payload) console.warn('shim: no payload injected');

  // Pick which coins are "tracked". Free tier shows 2, Pro shows a longer list,
  // which is what makes the Pro screenshot look different from the free one.
  // Default to coins that actually have something to show. Taking the payload
  // order gave 0G, which is alphabetically first AND one of the query-gated
  // coins, so every row read "no posts" over a three-bar chart. Rank by posts in
  // the last 24h and require a tone reading, so a screenshot shows a populated
  // card unless a specific coin is asked for.
  const rich = (payload?.coins || [])
    .filter(c => c.tone && c.topics && (c.activity?.posts || 0) > 0
                 && (c.spark?.v?.length || 0) > 50)
    .sort((a, b) => (b.activity?.posts || 0) - (a.activity?.posts || 0))
    .map(c => c.symbol);
  const pool = rich.length ? rich : (payload ? payload.coins.map(c => c.symbol) : []);
  let tracked = cfg.pro ? pool.slice(0, 12) : pool.slice(0, 2);
  if (cfg.coin && !cfg.detect) tracked = [cfg.coin, ...tracked.filter(s => s !== cfg.coin)];
  // Leave one free slot so the teaser offers "Add X to your tracked coins"
  // rather than the Go Pro variant, which is what the old listing image showed.
  if (cfg.detect) tracked = tracked.filter(s => s !== cfg.coin).slice(0, 1);
  if (!cfg.pro) tracked = tracked.slice(0, 2);

  const store = {
    trackedCoins: tracked,
    isPro: cfg.pro,
    lastPayload: payload,
    lastPushedAt: payload?.pushed_at,
    badgeMode: 'my_coins',
    notificationsEnabled: cfg.alerts,
    // Onboarding shows only when this is falsy, so the panel choice drives it.
    pickerSetupDone: cfg.panel !== 'onboarding',
    theme: cfg.theme,
  };

  // Hold the clock at the payload's own moment. The popup derives every "updated
  // X ago" from Date.now(), so a payload rewound to a past cycle would otherwise
  // render a ten-hour-old stamp over figures that were current at the time.
  //
  // This shifts the CLOCK, never a number. Everything on screen was measured at
  // the timestamp shown; the harness just stops "now" running away from it.
  if (payload?.pushed_at) {
    const frozen = new Date(payload.pushed_at).getTime() + 8 * 60 * 1000;
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(frozen); }
      static now() { return frozen; }
    };
    Date.parse = RealDate.parse;
    Date.UTC = RealDate.UTC;
  }

  const listeners = [];
  window.chrome = {
    storage: {
      local: {
        get(keys) {
          const out = {};
          const list = keys == null ? Object.keys(store)
                     : (Array.isArray(keys) ? keys : [keys]);
          list.forEach(k => { if (k in store) out[k] = store[k]; });
          return Promise.resolve(out);
        },
        set(obj)   { Object.assign(store, obj); return Promise.resolve(); },
        remove(ks) { (Array.isArray(ks) ? ks : [ks]).forEach(k => delete store[k]);
                     return Promise.resolve(); },
      },
      onChanged: { addListener(fn) { listeners.push(fn); } },
    },
    runtime: {
      // Never fetches. The payload is already seeded, and a screenshot run must
      // not depend on the network being up.
      sendMessage(_msg, cb) { if (typeof cb === 'function') cb({ ok: true }); },
      lastError: undefined,
      getURL(p) { return p; },
    },
    tabs: {
      // Drives the "context aware" detection. A Binance URL for the requested
      // coin makes the popup open on that coin, exactly as it would in use.
      query() {
        const sym = cfg.coin || tracked[0] || 'BTC';
        return Promise.resolve([{ id: 1, url: 'https://www.binance.com/en/trade/' + sym + '_USDT' }]);
      },
      create() {},
    },
    permissions: {
      contains() { return Promise.resolve(cfg.alerts); },
      request()  { return Promise.resolve(true); },
    },
  };

  // ExtPay only matters for the upgrade button, which is never clicked here.
  window.ExtPay = function () {
    return {
      getUser: () => Promise.resolve({ paid: cfg.pro }),
      openPaymentPage() {}, openLoginPage() {},
      onPaid: { addListener() {} },
      startBackground() {},
    };
  };

  // After the popup has rendered, apply the parts of the scenario that are DOM
  // state rather than storage: which overlay is open, which timeframe is active.
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const ids = { onboarding: 'onboarding-panel', methodology: 'methodology-panel',
                    sites: 'sites-panel', privacy: 'privacy-panel', picker: 'picker-panel' };
      Object.values(ids).forEach(id => document.getElementById(id)?.classList.add('hidden'));
      // Click the real control rather than un-hiding the panel. The picker's list
      // is built by openPicker(); removing .hidden alone produced a correctly
      // styled but EMPTY panel, which looked like a product bug and was not one.
      const opener = { picker: 'nav-edit-btn', methodology: 'footer-methodology-link',
                       sites: 'footer-sites-link', privacy: 'footer-privacy-link' }[cfg.panel];
      if (opener && document.getElementById(opener)) {
        document.getElementById(opener).click();
      } else if (cfg.panel && ids[cfg.panel]) {
        document.getElementById(ids[cfg.panel])?.classList.remove('hidden');
      }
      if (cfg.tf) document.querySelector('.tf-btn[data-tf="' + cfg.tf + '"]')?.click();
      // Picker sort chips, so the shot can show the current "Busiest" ordering
      // rather than the retired four activity filters.
      if (cfg.sort) {
        const hit = document.querySelector('.sort-chip[data-sort="' + cfg.sort + '"]');
        if (hit) hit.click();
      }
      document.documentElement.setAttribute('data-shot-ready', '1');
    }, 400);
  });
})();
