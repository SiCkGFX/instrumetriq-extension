'use strict';

const FREE_LIMIT = 2;

// ── State ─────────────────────────────────────────────────────────────
let currentPayload      = null;
let trackedCoins        = [];
let isPro               = false;
let badgeMode           = 'my_coins';
let notificationsEnabled = true;
let pickerSetupDone     = false;
let currentCardIdx      = 0;
let upgradePromptTarget = null;
let isFirstRun          = false;
let lastDetectedSymbol  = null; // cached across re-renders
let theme               = 'auto';
let pickerSort          = 'alpha';

// ── DOM references ────────────────────────────────────────────────────
let cardAreaEl, prevBtn, nextBtn, counterEl, coinNameEl, editBtn;
let refreshBtn;
let searchBtn, searchBar, searchInput, searchDropdown;
let pickerPanel, pickerCloseBtn, pickerDoneBtn, pickerSearchInput, coinListEl;
let pickerBulkActionsEl, pickerSelectAllBtn, pickerDeselectAllBtn, pickerSortChipsEl;
let footerActiveCountEl, footerCtaEl, footerRestoreEl;
let onboardingPanel, onboardingContinueBtn;
let privacyPanel, privacyCloseBtn, footerPrivacyLink;
let sitesPanel, sitesPanelCloseBtn, footerSitesLink, footerBrandLink;
let methodologyPanel, methodologyCloseBtn, footerMethodologyLink;
let themeToggleEl;
let searchHilIdx = -1;

// ── Entry point ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  assignDomRefs();
  wireInteractions();

  // Single batched storage read
  const stored = await chrome.storage.local.get([
    'trackedCoins', 'isPro', 'lastPayload', 'badgeMode',
    'notificationsEnabled', 'pickerSetupDone', 'theme'
  ]);

  trackedCoins         = stored.trackedCoins         ?? [];
  isPro                = stored.isPro                ?? false;
  currentPayload       = stored.lastPayload          ?? null;
  badgeMode            = stored.badgeMode            ?? 'my_coins';
  notificationsEnabled = stored.notificationsEnabled ?? false;
  pickerSetupDone      = stored.pickerSetupDone      ?? false;
  theme                = stored.theme                ?? 'auto';

  applyTheme(theme);
  syncHeaderControls();

  // First-run: show onboarding overlay, then open picker on continue
  if (!pickerSetupDone) {
    isFirstRun = true;
    onboardingPanel.classList.remove('hidden');
    return;
  }

  // Context-aware activation: query active tab's content script
  const detectedRaw    = await queryContentScript();
  lastDetectedSymbol   = resolveSymbol(detectedRaw, currentPayload?.coins ?? []);

  render(lastDetectedSymbol);

  // Request fresh fetch from SW if nothing is cached yet
  if (!currentPayload) {
    chrome.runtime.sendMessage({ type: 'FETCH_NOW' });
  }
});

// ── React to new payload arriving from background service worker ──────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let needsRender = false;
  if (changes.lastPayload)  { currentPayload = changes.lastPayload.newValue;   needsRender = true; }
  if (changes.trackedCoins) { trackedCoins   = changes.trackedCoins.newValue ?? []; needsRender = true; }  if (changes.isPro)        { isPro          = changes.isPro.newValue ?? false;      needsRender = true; }  if (needsRender) render(lastDetectedSymbol);
});

// ── Assign DOM references ─────────────────────────────────────────────
function assignDomRefs() {
  cardAreaEl        = document.getElementById('card-area');
  prevBtn           = document.getElementById('nav-prev');
  nextBtn           = document.getElementById('nav-next');
  counterEl         = document.getElementById('nav-counter');
  coinNameEl        = document.querySelector('.nav-coin-name');
  editBtn           = document.getElementById('nav-edit-btn');
  refreshBtn        = document.getElementById('nav-refresh-btn');
  searchBtn         = document.getElementById('nav-search-btn');
  searchBar         = document.querySelector('.coin-search-bar');
  searchInput       = document.getElementById('coin-search-input');
  searchDropdown    = document.getElementById('search-dropdown');
  pickerPanel       = document.getElementById('picker-panel');
  pickerCloseBtn    = document.getElementById('picker-close');
  pickerDoneBtn     = document.getElementById('picker-done');
  pickerSearchInput = document.getElementById('picker-search-input');
  coinListEl        = document.getElementById('coin-list');
  pickerBulkActionsEl  = document.getElementById('picker-bulk-actions');
  pickerSelectAllBtn   = document.getElementById('picker-select-all');
  pickerDeselectAllBtn = document.getElementById('picker-deselect-all');
  pickerSortChipsEl    = document.getElementById('picker-sort-chips');
  footerActiveCountEl = document.querySelector('.footer-active-count');
  footerCtaEl       = document.querySelector('.footer-cta');
  footerRestoreEl   = document.querySelector('.footer-restore');
  onboardingPanel      = document.getElementById('onboarding-panel');
  onboardingContinueBtn = document.getElementById('onboarding-continue');
  privacyPanel         = document.getElementById('privacy-panel');
  privacyCloseBtn      = document.getElementById('privacy-close');
  footerPrivacyLink    = document.getElementById('footer-privacy-link');
  sitesPanel           = document.getElementById('sites-panel');
  sitesPanelCloseBtn   = document.getElementById('sites-close');
  footerSitesLink      = document.getElementById('footer-sites-link');
  footerBrandLink      = document.getElementById('footer-brand-link');
  methodologyPanel     = document.getElementById('methodology-panel');
  methodologyCloseBtn  = document.getElementById('methodology-close');
  footerMethodologyLink = document.getElementById('footer-methodology-link');
  themeToggleEl        = document.getElementById('theme-toggle');
}

// ── Wire all fixed-element interactions ───────────────────────────────
function wireInteractions() {
  prevBtn.addEventListener('click', () => {
    const cards = getCards();
    if (cards.length) showCard((currentCardIdx + cards.length - 1) % cards.length);
  });
  nextBtn.addEventListener('click', () => {
    const cards = getCards();
    if (cards.length) showCard((currentCardIdx + 1) % cards.length);
  });

  editBtn.addEventListener('click', openPicker);
  counterEl.addEventListener('click', openPicker);

  refreshBtn.addEventListener('click', onRefreshClick);

  pickerCloseBtn.addEventListener('click', closePicker);
  pickerDoneBtn.addEventListener('click', onPickerDone);

  pickerSearchInput.addEventListener('input', () => {
    upgradePromptTarget = null;
    renderPickerList(pickerSearchInput.value.trim().toUpperCase());
  });

  pickerSelectAllBtn.addEventListener('click', () => {
    if (!isPro) return;
    trackedCoins = getSortedPickerCoins().map(c => c.symbol);
    renderPickerList(pickerSearchInput.value.trim().toUpperCase());
  });

  pickerDeselectAllBtn.addEventListener('click', () => {
    trackedCoins = [];
    renderPickerList(pickerSearchInput.value.trim().toUpperCase());
  });

  pickerSortChipsEl.addEventListener('click', e => {
    const chip = e.target.closest('.sort-chip');
    if (!chip) return;
    const val = chip.dataset.sort;
    if (val && val !== pickerSort) {
      pickerSort = val;
      pickerSortChipsEl.querySelectorAll('.sort-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.sort === pickerSort);
      });
      renderPickerList(pickerSearchInput.value.trim().toUpperCase());
    }
  });

  // Wire upgrade and restore links anywhere on the page (cards + picker are dynamic)
  const extpay = ExtPay('instrumetriq');
  const planChoiceEl = document.getElementById('plan-choice');
  const planChoiceCloseBtn = document.getElementById('plan-choice-close');

  function showPlanChoice() {
    planChoiceEl.classList.remove('hidden');
  }

  planChoiceEl.addEventListener('click', e => {
    const btn = e.target.closest('.plan-btn');
    if (!btn) return;
    const plan = btn.dataset.plan;
    if (plan) {
      planChoiceEl.classList.add('hidden');
      extpay.openPaymentPage(plan);
    }
  });

  planChoiceCloseBtn.addEventListener('click', () => {
    planChoiceEl.classList.add('hidden');
  });

  document.addEventListener('click', e => {
    if (e.target.classList.contains('upgrade-link')) {
      e.preventDefault();
      showPlanChoice();
    }
    if (e.target.classList.contains('teaser-add-link')) {
      e.preventDefault();
      const sym = e.target.dataset.symbol;
      if (sym && !trackedCoins.includes(sym)) {
        trackedCoins.push(sym);
        chrome.storage.local.set({ trackedCoins: trackedCoins });
        render(lastDetectedSymbol);
      }
    }
    if (e.target.classList.contains('restore-link')) {
      e.preventDefault();
      extpay.openLoginPage();
    }
  });

  if (footerCtaEl) footerCtaEl.addEventListener('click', e => {
    e.preventDefault();
    if (!isPro) showPlanChoice();
  });
  if (footerRestoreEl) footerRestoreEl.addEventListener('click', e => {
    e.preventDefault();
    extpay.openLoginPage();
  });

  document.querySelectorAll('.pill-option').forEach(opt => {
    opt.addEventListener('click', () => onPillClick(opt));
  });

  document.querySelector('.switch-toggle').addEventListener('click', onAlertsToggle);

  onboardingContinueBtn.addEventListener('click', () => {
    onboardingPanel.classList.add('hidden');
    openPicker();
  });

  footerPrivacyLink.addEventListener('click', e => {
    e.preventDefault();
    privacyPanel.classList.remove('hidden');
  });
  privacyCloseBtn.addEventListener('click', () => {
    privacyPanel.classList.add('hidden');
  });

  footerSitesLink.addEventListener('click', e => {
    e.preventDefault();
    sitesPanel.classList.remove('hidden');
  });
  sitesPanelCloseBtn.addEventListener('click', () => {
    sitesPanel.classList.add('hidden');
  });

  footerMethodologyLink.addEventListener('click', e => {
    e.preventDefault();
    methodologyPanel.classList.remove('hidden');
  });
  methodologyCloseBtn.addEventListener('click', () => {
    methodologyPanel.classList.add('hidden');
  });

  // "How it works" link from sparkline footnote (delegated, since cards are dynamic)
  document.addEventListener('click', e => {
    if (e.target.classList.contains('methodology-link')) {
      e.preventDefault();
      methodologyPanel.classList.remove('hidden');
    }
  }, true);

  // Sparkline timeframe selector (delegated, since cards are dynamic)
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.tf-btn');
    if (!btn) return;
    var tf = btn.dataset.tf;
    var card = btn.closest('.card');
    if (!card || !tf) return;
    // Toggle active state
    btn.parentElement.querySelectorAll('.tf-btn').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    // Find coin data and re-render bars
    var sym = card.dataset.symbol;
    var coin = (currentPayload?.coins ?? []).find(function (c) { return c.symbol === sym; });
    if (!coin?.sparkline?.length) return;
    var agg = aggregateSparkline(coin.sparkline, coin.sparkline_tone, coin.sparkline_ts, tf, coin.sparkline_pos, coin.sparkline_neg);
    var wrap = card.querySelector('.sparkline-chart-wrap');
    if (wrap) wrap.innerHTML = buildSparklineBarsHtml(agg.vals, agg.tones, agg.stamps, tf, agg.keys, agg.pos, agg.neg);
  }, true);

  footerBrandLink.addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://instrumetriq.com' });
  });

  searchBtn.addEventListener('click', () => {
    searchBar.classList.contains('hidden') ? openSearch() : closeSearch();
  });
  document.addEventListener('click', e => {
    if (searchBar && !searchBar.contains(e.target) && e.target !== searchBtn) closeSearch();
  });
  searchInput.addEventListener('input', onSearchInput);
  searchInput.addEventListener('keydown', onSearchKeydown);

  themeToggleEl.addEventListener('click', e => {
    const btn = e.target.closest('.theme-btn');
    if (!btn) return;
    const val = btn.dataset.themeValue;
    if (val && val !== theme) {
      theme = val;
      applyTheme(theme);
      chrome.storage.local.set({ theme });
      themeToggleEl.querySelectorAll('.theme-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.themeValue === theme);
      });
    }
  });

  // JS tooltip for spark bars (CSS ::after clipped by overflow:hidden ancestors)
  var sparkTip = document.createElement('div');
  sparkTip.className = 'spark-tooltip';
  document.body.appendChild(sparkTip);
  var sparkTipTimer = null;

  document.addEventListener('mouseenter', function (e) {
    if (!e.target.classList || !e.target.classList.contains('spark-bar')) return;
    var text = e.target.getAttribute('data-tooltip');
    if (!text) return;
    clearTimeout(sparkTipTimer);
    sparkTip.innerHTML = text.replace(/\n/g, '<br>');
    sparkTip.style.opacity = '1';
    var rect = e.target.getBoundingClientRect();
    var tipW = sparkTip.offsetWidth;
    var left = rect.left + rect.width / 2 - tipW / 2;
    // Clamp to popup viewport
    if (left < 4) left = 4;
    if (left + tipW > document.documentElement.clientWidth - 4) {
      left = document.documentElement.clientWidth - 4 - tipW;
    }
    sparkTip.style.left = left + 'px';
    var tipH = sparkTip.offsetHeight;
    var above = rect.top - tipH - 4;
    sparkTip.style.top = (above < 2 ? rect.bottom + 4 : above) + 'px';
  }, true);

  document.addEventListener('mouseleave', function (e) {
    if (!e.target.classList || !e.target.classList.contains('spark-bar')) return;
    sparkTipTimer = setTimeout(function () { sparkTip.style.opacity = '0'; }, 80);
  }, true);
}

// ── Query active tab's content script for coin symbol ─────────────────
async function queryContentScript() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    return await chrome.tabs.sendMessage(tab.id, { type: 'GET_COIN_SYMBOL' });
  } catch (_e) {
    return null; // tab has no content script (not a trading page) - silent
  }
}

// Resolve a raw string (e.g. "ZENUSDT") to a base symbol ("ZEN")
function resolveSymbol(raw, payloadCoins) {
  if (!raw || !payloadCoins?.length) return null;
  const upper = raw.toUpperCase();
  for (const coin of payloadCoins) {
    if (coin.symbol === upper) return coin.symbol;
    if (coin.pair_symbols?.includes(upper)) return coin.symbol;
  }
  return null;
}

// ── Main render ───────────────────────────────────────────────────────
function render(detectedSymbol) {
  if (!currentPayload) {
    cardAreaEl.innerHTML = '<p class="no-data-msg">Loading data...</p>';
    return;
  }

  if (!currentPayload.feed_ok) {
    cardAreaEl.innerHTML =
      '<div class="feed-banner">' +
        '<p class="feed-banner-msg">Data temporarily unavailable. ' +
        'The extension will recover automatically.</p>' +
      '</div>';
    return;
  }

  const coinMap = {};
  (currentPayload.coins ?? []).forEach(c => { coinMap[c.symbol] = c; });

  const specs = [];

  // Teaser card for a coin detected on the current page that is not yet tracked
  const detected = detectedSymbol
    ? resolveSymbol(detectedSymbol, currentPayload.coins)
    : null;
  if (detected && !trackedCoins.includes(detected) && coinMap[detected]) {
    specs.push({ type: 'teaser', symbol: detected, coin: coinMap[detected] });
  }

  // Normal cards for tracked coins (Pro: sorted by chatter level)
  const effectiveTracked = isPro ? trackedCoins.slice() : trackedCoins.slice(0, FREE_LIMIT);
  if (isPro) {
    const levelOrder = { Spiking: 0, Buzzing: 1, Active: 2, Quiet: 3 };
    effectiveTracked.sort((a, b) => {
      const la = coinMap[a]?.chatter?.ok ? (levelOrder[coinMap[a].chatter.level] ?? 4) : 4;
      const lb = coinMap[b]?.chatter?.ok ? (levelOrder[coinMap[b].chatter.level] ?? 4) : 4;
      return la - lb;
    });
  }
  effectiveTracked.forEach(sym => {
    if (coinMap[sym]) specs.push({ type: 'normal', symbol: sym, coin: coinMap[sym] });
  });

  // Ghost cards for coins beyond the free limit (expired Pro scenario)
  if (!isPro && trackedCoins.length > FREE_LIMIT) {
    trackedCoins.slice(FREE_LIMIT).forEach(sym => {
      specs.push({ type: 'ghost', symbol: sym });
    });
  }

  if (!specs.length) {
    cardAreaEl.innerHTML =
      '<p class="no-data-msg">No coins tracked yet. Tap Edit to choose your coins.</p>';
    if (coinNameEl) coinNameEl.textContent = '';
    if (counterEl) counterEl.textContent = 'Edit';
    updateFooter();
    return;
  }

  cardAreaEl.innerHTML = specs.map((s, i) =>
    buildCardHtml(s, i === 0 ? 'active-card' : 'hidden-card')
  ).join('');

  // Start on detected coin if present
  let startIdx = 0;
  if (detected) {
    const di = specs.findIndex(s => s.symbol === detected);
    if (di >= 0) startIdx = di;
  }

  currentCardIdx = startIdx;
  showCard(currentCardIdx);
  updateFooter();

  // Briefly highlight the detected coin card
  if (detected) {
    const el = cardAreaEl.querySelector('[data-symbol="' + detected + '"]');
    if (el) {
      el.classList.remove('highlight-detected'); // reset if re-rendering
      void el.offsetWidth;                       // force reflow to restart animation
      el.classList.add('highlight-detected');
    }
  }
}

// ── Card HTML builders ────────────────────────────────────────────────
function buildCardHtml(spec, visClass) {
  if (spec.type === 'ghost')  return buildGhostCardHtml(spec.symbol, visClass);
  if (spec.type === 'teaser') return buildTeaserCardHtml(spec.symbol, spec.coin, visClass);
  return buildNormalCardHtml(spec.coin, visClass);
}

function buildGhostCardHtml(symbol, visClass) {
  return '<div class="card ghost-card ' + visClass + '" data-symbol="' + esc(symbol) + '">' +
    '<div class="card-header">' +
      '<span class="coin-symbol">' + esc(symbol) + '</span>' +
      '<span class="ghost-lock">&#x1F512;</span>' +
    '</div>' +
    '<p class="ghost-msg">Pro required. ' +
      '<a href="#" class="upgrade-link">Resubscribe to restore.</a>' +
    '</p>' +
  '</div>';
}

function buildTeaserCardHtml(symbol, coin, visClass) {
  const level = coin?.chatter?.ok ? coin.chatter.level : null;
  const isHot = level === 'Buzzing' || level === 'Spiking';
  const badgeHtml = level
    ? '<span class="level-badge ' + level.toLowerCase() + '">' + esc(level.toUpperCase()) + '</span>'
    : '';
  const canAdd = isPro || trackedCoins.length < FREE_LIMIT;
  var ctaText;
  if (canAdd) {
    ctaText = isHot
      ? esc(symbol) + ' is getting unusual chatter. '
      : '';
    ctaText += '<a href="#" class="teaser-add-link" data-symbol="' + esc(symbol) + '">Add ' + esc(symbol) + ' to your tracked coins.</a>';
  } else {
    ctaText = isHot
      ? esc(symbol) + ' is getting unusual chatter. '
      : '';
    ctaText += '<a href="#" class="upgrade-link">Go Pro to track ' + esc(symbol) + ' and all 257 coins.</a>' +
      '<br><span class="teaser-hint">Or press <strong>Edit</strong> to replace one of your tracked coins.</span>';
  }
  return '<div class="card teaser-card ' + visClass + '" data-symbol="' + esc(symbol) + '">' +
    '<div class="card-header">' +
      '<span class="coin-symbol">' + esc(symbol) + '</span>' +
      badgeHtml +
    '</div>' +
    '<p class="teaser-cta">' + ctaText + '</p>' +
  '</div>';
}

function buildNormalCardHtml(coin, visClass) {
  const sym   = coin.symbol;
  const level = coin.chatter?.ok ? coin.chatter.level : null;
  const stCls = level ? 'state-' + level.toLowerCase() : '';

  const badgeHtml = level
    ? '<span class="level-badge ' + level.toLowerCase() + '" data-tooltip="' +
        esc(levelBadgeTooltip(level)) + '">' + esc(level.toUpperCase()) + '</span>'
    : '';

  return '<div class="card ' + stCls + ' ' + visClass + '" data-symbol="' + esc(sym) + '">' +
    '<div class="card-header">' +
      '<span class="coin-symbol">' + esc(sym) + '</span>' +
      badgeHtml +
    '</div>' +
    buildScaleHtml(level) +
    buildSparklineHtml(coin) +
    '<div class="data-rows">' + buildRowsHtml(coin) + '</div>' +
    buildXLink(sym, level) +
    '<div class="updated-ago">' + buildUpdatedAgo(coin) + '</div>' +
    '<p class="card-disclaimer">Social chatter data only. Not a trading signal. Data may be delayed.</p>' +
  '</div>';
}

// ── Level scale strip ─────────────────────────────────────────────────
function buildScaleHtml(level) {
  const steps = ['Quiet', 'Active', 'Buzzing', 'Spiking'];
  const tips = {
    Quiet:   'EC ratio < 0.5x\nthe coin\'s 30-day average',
    Active:  'EC ratio 0.5x - 2x\nthe coin\'s 30-day average',
    Buzzing: 'EC ratio 2x - 6x\nthe coin\'s 30-day average',
    Spiking: 'EC ratio > 6x\nthe coin\'s 30-day average'
  };
  var inner = '';
  steps.forEach(function (s, i) {
    const cur = s === level ? ' current' : '';
    inner += '<span class="scale-step' + cur + '" data-tooltip="' + tips[s] + '">' + s + '</span>';
    if (i < steps.length - 1) inner += '<span class="scale-divider">&#x203A;</span>';
  });
  return '<div class="level-scale">' + inner + '</div>';
}

// ── Sparkline ─────────────────────────────────────────────────────────

// Aggregate sparkline data into per-day or per-week buckets.
// Each bucket: mean EC, dominant tone, representative timestamp.
var CYCLE_DAYS = 7; // rolling 7-day window for per-cycle bars

function aggregateSparkline(sl, tone, ts, mode, posArr, negArr) {
  if (mode === 'cycle') {
    // Use timestamps to enforce a strict rolling 7-day window
    var start = 0;
    if (ts && ts.length) {
      var cutoff = new Date(Date.now() - CYCLE_DAYS * 86400000).toISOString();
      for (var i = 0; i < ts.length; i++) {
        if (ts[i] >= cutoff) { start = i; break; }
      }
    } else {
      // Fallback: no timestamps, take last ~60 entries (rough 7d estimate)
      start = Math.max(0, sl.length - 60);
    }
    return {
      vals:   sl.slice(start),
      tones:  tone  ? tone.slice(start)  : null,
      stamps: ts    ? ts.slice(start)    : null,
      pos:    posArr ? posArr.slice(start) : null,
      neg:    negArr ? negArr.slice(start) : null
    };
  }

  var buckets = {};  // key -> { sum, count, tones: {}, ts }

  // For week mode: build 7-day windows counting backwards from today
  var weekEdges = null; // array of { start, end, key } newest-first
  if (mode === 'week') {
    weekEdges = [];
    var today = new Date(); today.setUTCHours(23,59,59,999);
    var cursor = new Date(today);
    while (weekEdges.length < 4) { // 4 weeks = 28 days, within 30-day window
      var wEnd = new Date(cursor);
      var wStart = new Date(cursor); wStart.setUTCDate(wStart.getUTCDate() - 6);
      wStart.setUTCHours(0,0,0,0);
      var sk = wStart.toISOString().slice(0,10);
      var ek = wEnd.toISOString().slice(0,10);
      weekEdges.push({ start: wStart.getTime(), end: wEnd.getTime(), key: sk + '|' + ek });
      cursor = new Date(wStart); cursor.setUTCDate(cursor.getUTCDate() - 1);
      cursor.setUTCHours(23,59,59,999);
    }
    weekEdges.reverse(); // oldest first
  }

  // 30-day cutoff for day mode
  var cutoff30d = new Date();
  cutoff30d.setUTCDate(cutoff30d.getUTCDate() - 30);
  cutoff30d.setUTCHours(0, 0, 0, 0);
  var cutoff30dMs = cutoff30d.getTime();

  for (var i = 0; i < sl.length; i++) {
    var key;
    var d = new Date(ts[i]);
    if (mode === 'day') {
      if (d.getTime() < cutoff30dMs) continue; // skip entries older than 30 days
      key = ts[i].slice(0, 10); // YYYY-MM-DD
    } else {
      // Find which 7-day window this timestamp falls into
      var dMs = d.getTime();
      key = null;
      for (var w = 0; w < weekEdges.length; w++) {
        if (dMs >= weekEdges[w].start && dMs <= weekEdges[w].end) { key = weekEdges[w].key; break; }
      }
      if (!key) continue; // outside all windows, skip
    }
    if (!buckets[key]) buckets[key] = { sum: 0, count: 0, toneSum: 0, toneCount: 0, ts: ts[i], posSum: 0, negSum: 0, ratioCount: 0 };
    buckets[key].sum += sl[i];
    buckets[key].count++;
    if (tone && tone[i] != null) {
      buckets[key].toneSum += tone[i];
      buckets[key].toneCount++;
    }
    buckets[key].ts = ts[i]; // keep latest ts in bucket
    if (posArr && posArr[i] != null && negArr && negArr[i] != null) {
      buckets[key].posSum += posArr[i];
      buckets[key].negSum += negArr[i];
      buckets[key].ratioCount++;
    }
  }

  var keys = Object.keys(buckets).sort();
  var vals = [], tones = [], stamps = [], bucketKeys = [], pos = [], neg = [];
  keys.forEach(function (k) {
    var b = buckets[k];
    vals.push(b.sum / b.count);
    // Average net tone score for the bucket
    tones.push(b.toneCount > 0 ? Math.round(b.toneSum / b.toneCount) : null);
    stamps.push(b.ts);
    bucketKeys.push(k);
    if (b.ratioCount > 0) {
      pos.push(b.posSum / b.ratioCount);
      neg.push(b.negSum / b.ratioCount);
    } else {
      pos.push(null);
      neg.push(null);
    }
  });
  return { vals: vals, tones: tones, stamps: stamps, keys: bucketKeys, pos: pos, neg: neg };
}

function buildSparklineBarsHtml(vals, tones, stamps, mode, bucketKeys, posArr, negArr) {
  var logVals = vals.map(function (v) { return Math.log1p(v); });
  var logMax  = Math.max.apply(null, logVals);
  var logMean = logVals.reduce(function (a, b) { return a + b; }, 0) / logVals.length;
  var avgPct  = logMax > 0 ? Math.round((logMean / logMax) * 100) : 0;
  // Position Avg label in y-axis: 14px padding offset + avgPct% of 56px sparkline height
  var avgLabelBottom = (14 + Math.round(avgPct * 0.56)) + 'px';

  var bars = '';
  vals.forEach(function (v, i) {
    var h = logMax > 0 ? Math.round((logVals[i] / logMax) * 100) : 0;
    var t = (tones && tones[i] != null) ? (tones[i] > 8 ? 'positive' : tones[i] >= -8 ? 'mixed' : 'negative') : 'mixed';
    var ecFmt = v >= 1000 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : '0';
    var ecLbl = (v <= 0 || ecFmt === '0') ? 'EC 0 (silent)' : 'EC ' + ecFmt;
    if (mode === 'day')  ecLbl += ' (daily avg)';
    if (mode === 'week') ecLbl += ' (weekly avg)';
    var dateLbl = formatBarDate(stamps && stamps[i], mode, bucketKeys && bucketKeys[i]);
    var toneLbl = '';
    if (tones && tones[i] != null) {
      toneLbl = 'Shift ' + (tones[i] > 0 ? '+' : '') + tones[i];
    }
    var tipLines = [ecLbl];
    if (toneLbl) tipLines.push(toneLbl);
    if (dateLbl) tipLines.push(dateLbl);
    var tip = tipLines.map(esc).join('\n');
    bars += '<div class="spark-bar ' + t + '" style="height:' + h + '%" data-tooltip="' + tip + '"></div>';
  });

  var firstLabel = formatAxisDate(stamps && stamps[0], mode, bucketKeys && bucketKeys[0], 'first');
  var lastLabel  = formatAxisDate(stamps && stamps[stamps.length - 1], mode, bucketKeys && bucketKeys[bucketKeys ? bucketKeys.length - 1 : 0], 'last') || 'Now';

  return '<div class="sparkline-chart">' +
    '<div class="y-axis">' +
      '<span class="y-label">High</span>' +
      '<span class="y-label y-avg" style="bottom:' + avgLabelBottom + '">Avg</span>' +
      '<span class="y-label">Low</span>' +
    '</div>' +
    '<div class="sparkline-bars-wrap">' +
      '<div class="sparkline sparkline-tf-' + mode + '" aria-hidden="true">' +
        '<div class="spark-avg-line" style="bottom:' + avgPct + '%"></div>' +
        bars +
      '</div>' +
      '<div class="x-axis">' +
        '<span class="x-label">' + firstLabel + '</span>' +
        '<span class="x-label">' + lastLabel + '</span>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function buildSparklineHtml(coin) {
  var sl   = coin.sparkline;
  var tone = coin.sparkline_tone;
  var ts   = coin.sparkline_ts;

  var headerHtml =
    '<div class="sparkline-header">' +
      '<span class="sparkline-label" data-tooltip="How much people are talking about this coin.&#10;Each bar is one data cycle (~3h &#177;1h).&#10;Taller bars = more engagement.&#10;Colors show tone.">Chatter activity</span>' +
      '<div class="sparkline-controls">' +
        '<div class="sparkline-tf" data-tooltip="Switch timeframe: per-cycle, daily, or weekly bars.">' +
          '<button class="tf-btn active" data-tf="cycle">C</button>' +
          '<button class="tf-btn" data-tf="day">D</button>' +
          '<button class="tf-btn" data-tf="week">W</button>' +
        '</div>' +
        '<div class="sparkline-legend">' +
          '<span class="legend-dot positive"></span><span class="legend-text">Pos. shift</span>' +
          '<span class="legend-dot negative"></span><span class="legend-text">Neg. shift</span>' +
          '<span class="legend-dot mixed"></span><span class="legend-text">Baseline</span>' +
        '</div>' +
      '</div>' +
    '</div>';

  if (!sl?.length) {
    return headerHtml +
      '<div class="sparkline-chart sparkline-empty">' +
        '<span class="sparkline-no-data">Not enough data yet</span>' +
      '</div>';
  }

  var agg = aggregateSparkline(sl, tone, ts, 'cycle', coin.sparkline_pos, coin.sparkline_neg);
  var barsHtml = buildSparklineBarsHtml(agg.vals, agg.tones, agg.stamps, 'cycle', null, agg.pos, agg.neg);

  return headerHtml + '<div class="sparkline-chart-wrap">' + barsHtml + '</div>' +
    '<p class="sparkline-footnote">Bars show engagement on a log scale. <a href="#" class="methodology-link">How it works</a></p>';
}

// ── Data rows ─────────────────────────────────────────────────────────
function buildRowsHtml(coin) {
  var html = '';

  // Chatter tone row - shift-based when baseline available, fallback to raw net otherwise
  const toneShift = coin.chatter?.tone_shift;
  const toneRaw = coin.chatter?.tone_raw;
  const toneBaseline = coin.chatter?.tone_baseline;
  if (toneShift != null) {
    const tCls = toneClass(toneShift);
    var shiftFmt = (toneShift > 0 ? '+' : '') + toneShift;
    var label = toneLabel(toneShift);
    var baselineFmt = toneBaseline != null ? ((toneBaseline > 0 ? '+' : '') + toneBaseline) : '?';
    var toneTooltipText = label + ' (shift ' + shiftFmt + '). This coin\'s 30-day baseline is ' + baselineFmt + '. Current sentiment has shifted ' + Math.abs(toneShift) + ' points ' + (toneShift >= 0 ? 'above' : 'below') + ' its usual level.';
    html += '<div class="data-row">' +
      '<span class="row-label" data-tooltip="How sentiment compares to this coin\'s own 30-day average.">Chatter tone</span>' +
      '<span class="row-value ' + tCls + '" data-tooltip="' + esc(toneTooltipText) + '">' +
        esc(label + ' \u00B7 ' + shiftFmt + ' shift') +
      '</span>' +
    '</div>';
  } else if (toneRaw != null) {
    var rawFmt = (toneRaw > 0 ? '+' : '') + toneRaw;
    var fbLabel = toneFallbackLabel(toneRaw);
    var fbCls = toneFallbackClass(toneRaw);
    var fbTooltip = fbLabel + ' (net ' + rawFmt + '). Not enough history yet to compute a baseline shift. Label will become more precise as data accumulates.';
    html += '<div class="data-row">' +
      '<span class="row-label" data-tooltip="How sentiment compares to this coin\'s own 30-day average.">Chatter tone</span>' +
      '<span class="row-value ' + fbCls + '" data-tooltip="' + esc(fbTooltip) + '">' +
        esc(fbLabel + ' \u00B7 ' + rawFmt + ' net') +
      '</span>' +
    '</div>';
  } else if (coin.chatter?.ok) {
    html += '<div class="data-row">' +
      '<span class="row-label" data-tooltip="How sentiment compares to this coin\'s own 30-day average.">Chatter tone</span>' +
      '<span class="row-value" data-tooltip="Not enough posts to determine sentiment reliably in the last update.">Insufficient data</span>' +
    '</div>';
  } else {
    html += '<div class="data-row">' +
      '<span class="row-label" data-tooltip="How sentiment compares to this coin\'s own 30-day average.">Chatter tone</span>' +
      '<span class="quality-label" data-tooltip="No chatter detected in the past 30 days.">Silent</span>' +
    '</div>';
  }

  // Volume row (after tone, before futures)
  if (coin.volume?.ok) {
    html += dataRow('24h volume',
      '24-hour rolling trading volume on Binance spot.',
      coin.volume.usd_fmt + ' \u00B7 ' + coin.volume.label,
      volumeTooltip(coin.volume.label), '');
  }

  // Futures rows (only when futures gate passes)
  if (coin.futures?.ok) {
    var fundingVal = coin.futures.funding_label;
    if (coin.futures.funding_rate) fundingVal += ' \u00B7 ' + coin.futures.funding_rate + ' / 8h';
    html += dataRow('Funding',
      'Perpetual futures funding rate. Shows whether leveraged traders are net long or short.',
      fundingVal,
      fundingTooltip(coin.futures.funding_label), '');
    var oiVal = coin.futures.oi_label;
    if (coin.futures.oi_usd_fmt) oiVal += ' \u00B7 ' + coin.futures.oi_usd_fmt;
    html += dataRow('OI flow',
      'Change in open interest over the last hour. Shows whether new money is entering or leaving derivatives.',
      oiVal,
      oiTooltip(coin.futures.oi_label), '');
    var longPct = coin.futures.whale_pct;
    var whaleVal = longPct != null ? longPct + '% long / ' + (100 - longPct) + '% short' : '-';
    var whaleTip = 'Ratio of long to short positions held by top exchange accounts in the last update.';
    if (coin.futures.whale_ratio != null) {
      whaleTip += ' Ratio: ' + coin.futures.whale_ratio + '.';
    }
    html += dataRow('Whale lean',
      'Long/short ratio of top-account traders, compared to the market\'s own recent range.',
      whaleVal,
      whaleTip, '');
  }

  return html;
}

function dataRow(label, labelTip, value, valueTip, extraClass) {
  return '<div class="data-row">' +
    '<span class="row-label" data-tooltip="' + esc(labelTip) + '">' + esc(label) + '</span>' +
    '<span class="row-value' + (extraClass ? ' ' + extraClass : '') + '" data-tooltip="' + esc(valueTip) + '">' + esc(value) + '</span>' +
  '</div>';
}

function buildXLink(sym, level) {
  if (level !== 'Buzzing' && level !== 'Spiking') return '';
  const href = 'https://x.com/search?q=%24' + encodeURIComponent(sym) + '&src=typed_query&f=live';
  return '<a class="x-link" href="' + href + '" target="_blank" rel="noopener">See what\'s being said &#x2192;</a>';
}

function buildUpdatedAgo(coin) {
  const agoAtBuild = coin.chatter?.updated_ago_min;
  if (agoAtBuild == null || !currentPayload?.pushed_at) return '';
  var pushedMs = new Date(currentPayload.pushed_at).getTime();
  var lastSeenMs = pushedMs - agoAtBuild * 60000;
  var min = Math.max(0, Math.round((Date.now() - lastSeenMs) / 60000));
  if (min < 60) return 'updated ' + min + ' min ago';
  var hr  = Math.floor(min / 60);
  var rem = min % 60;
  return rem ? 'updated ' + hr + 'h ' + rem + ' min ago' : 'updated ' + hr + 'h ago';
}

// ── Tooltip copy helpers ──────────────────────────────────────────────
function levelBadgeTooltip(level) {
  return {
    Spiking: 'Spiking: chatter is more than 6x above this coin\'s 30-day average. Very unusual activity.',
    Buzzing: 'Buzzing: chatter is 2-6x above this coin\'s 30-day average. Genuinely elevated attention.',
    Active:  'Active: chatter is within the normal 0.5-2x range for this coin. No unusual activity.',
    Quiet:   'Quiet: chatter is below 0.5x this coin\'s 30-day average. Below-average activity.'
  }[level] ?? '';
}

function levelValueTooltip(level) {
  return {
    Spiking: 'Chatter is more than 6x above this coin\'s 30-day average.',
    Buzzing: 'Chatter is 2-6x above this coin\'s 30-day average. Genuinely elevated attention.',
    Active:  'Chatter is within the normal 0.5-2x range for this coin. No unusual activity.',
    Quiet:   'Chatter is below 0.5x this coin\'s 30-day average. Below-average activity.'
  }[level] ?? '';
}

function toneLabel(shift) {
  if (shift > 16)  return 'Bullish';
  if (shift > 8)   return 'Positive';
  if (shift >= -8)  return 'Neutral';
  if (shift >= -16) return 'Negative';
  return 'Bearish';
}

function toneClass(shift) {
  if (shift > 8) return 'tone-positive';
  if (shift >= -8) return 'tone-mixed';
  return 'tone-negative';
}

function toneFallbackLabel(raw) {
  if (raw > 0) return 'Leaning positive';
  if (raw < 0) return 'Leaning negative';
  return 'Neutral';
}

function toneFallbackClass(raw) {
  if (raw > 10) return 'tone-positive';
  if (raw < -10) return 'tone-negative';
  return 'tone-mixed';
}

function fundingTooltip(label) {
  return {
    'Longs paying':  'Longs are paying shorts - more traders are positioned for price to go up.',
    'Shorts paying': 'Shorts are paying longs - more traders are positioned for price to go down.',
    'Neutral':       'Funding rate is near zero - no strong directional positioning.'
  }[label] ?? '';
}

function oiTooltip(label) {
  return {
    'OI rising':  'More contracts were opened in the last hour - new money entering the market.',
    'OI falling': 'Contracts were closed in the last hour - positions being reduced.',
    'OI stable':  'Open interest was roughly flat in the last hour - no significant new positioning.'
  }[label] ?? '';
}

function whaleTooltip(label) {
  return {
    'Whales leaning long':  'Large accounts are positioned unusually long relative to current market norms.',
    'Whales leaning short': 'Large accounts are positioned unusually short relative to current market norms.',
    'Neutral':              'Large accounts are positioned within the normal range for current market conditions.'
  }[label] ?? '';
}

function volumeTooltip(label) {
  return {
    'Elevated':  'Volume is above the 75th percentile of this coin\x27s own 30-day history. Unusual activity.',
    'Above avg': 'Volume is above the median for this coin over the past 30 days.',
    'Below avg': 'Volume is below the median for this coin over the past 30 days.',
    'Low':       'Volume is below the 25th percentile of this coin\x27s own 30-day history. Quieter than usual.'
  }[label] ?? '';
}

function qualityStateLabel(quality) {
  return {
    insufficient_data: 'Insufficient data',
    uncertain:         'Uncertain',
    stale:             'Stale',
    no_futures:        'No futures data'
  }[quality] ?? 'Data unavailable';
}

// ── Navigation ────────────────────────────────────────────────────────
function getCards() {
  return Array.from(cardAreaEl.querySelectorAll('.card'));
}

function showCard(i) {
  const cards = getCards();
  if (!cards.length) return;
  currentCardIdx = ((i % cards.length) + cards.length) % cards.length;
  cards.forEach((c, j) => {
    c.classList.toggle('active-card', j === currentCardIdx);
    c.classList.toggle('hidden-card', j !== currentCardIdx);
  });
  if (coinNameEl) coinNameEl.textContent = cards[currentCardIdx]?.dataset.symbol ?? '';
  if (counterEl)  counterEl.textContent  = (currentCardIdx + 1) + ' / ' + cards.length;
}

// ── Header controls ───────────────────────────────────────────────────
function syncHeaderControls() {
  document.querySelectorAll('.pill-option').forEach(opt => {
    const text = opt.textContent.trim();
    opt.classList.toggle('active',
      (text === 'My coins'  && badgeMode === 'my_coins') ||
      (text === 'All coins' && badgeMode === 'all_coins')
    );
  });
  const sw = document.querySelector('.switch-toggle');
  if (sw) {
    sw.classList.toggle('on',  notificationsEnabled);
    sw.classList.toggle('off', !notificationsEnabled);
  }
  // Sync theme toggle buttons
  if (themeToggleEl) {
    themeToggleEl.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeValue === theme);
    });
  }
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
}

async function onPillClick(opt) {
  document.querySelectorAll('.pill-option').forEach(o => o.classList.remove('active'));
  opt.classList.add('active');
  badgeMode = opt.textContent.trim() === 'All coins' ? 'all_coins' : 'my_coins';
  await chrome.storage.local.set({ badgeMode });
  chrome.runtime.sendMessage({ type: 'FETCH_NOW' }); // prompt SW to re-evaluate badge
}

async function onRefreshClick() {
  refreshBtn.classList.add('spinning');
  refreshBtn.classList.add('cooldown');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'FETCH_NOW' });
    if (resp?.ok) {
      const { lastPayload } = await chrome.storage.local.get('lastPayload');
      if (lastPayload) {
        currentPayload = lastPayload;
        render(lastDetectedSymbol);
      }
    }
  } catch (_e) { /* silent */ }
  refreshBtn.classList.remove('spinning');
  setTimeout(() => refreshBtn.classList.remove('cooldown'), 10_000);
}

async function onAlertsToggle() {
  notificationsEnabled = !notificationsEnabled;
  const sw = document.querySelector('.switch-toggle');
  sw.classList.toggle('on',  notificationsEnabled);
  sw.classList.toggle('off', !notificationsEnabled);
  await chrome.storage.local.set({ notificationsEnabled });
}

// ── Footer ────────────────────────────────────────────────────────────
function updateFooter() {
  if (!currentPayload) return;
  const coins = currentPayload.coins || [];
  const n = coins.filter(function(c) { return c.chatter && c.chatter.level === 'Spiking'; }).length;

  if (isPro) {
    if (footerActiveCountEl) {
      footerActiveCountEl.textContent = n > 0
        ? n + ' coins are Spiking right now.'
        : 'All 257 coins tracked.';
    }
    if (footerCtaEl)     { footerCtaEl.textContent = 'Pro plan active'; footerCtaEl.style.pointerEvents = 'none'; }
    if (footerRestoreEl) footerRestoreEl.classList.add('hidden');
    return;
  }

  if (footerActiveCountEl) {
    footerActiveCountEl.textContent = n > 0
      ? n + ' coins are Spiking right now.'
      : 'Track all 257 coins to get notified the moment they spike.';
  }
  if (footerCtaEl) {
    footerCtaEl.textContent = n > 0 ? 'Unlock all 257 \u2192' : 'Go Pro \u2192';
    footerCtaEl.style.pointerEvents = '';
  }
  if (footerRestoreEl) footerRestoreEl.classList.remove('hidden');
}

// ── Coin picker ───────────────────────────────────────────────────────
function openPicker() {
  pickerPanel.classList.remove('hidden');
  pickerSearchInput.value = '';
  upgradePromptTarget = null;
  pickerSort = 'alpha';
  if (pickerSortChipsEl) {
    pickerSortChipsEl.querySelectorAll('.sort-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.sort === 'alpha');
    });
  }
  // Show bulk actions only for Pro users
  if (pickerBulkActionsEl) pickerBulkActionsEl.classList.toggle('hidden', !isPro);
  renderPickerList('');
  pickerSearchInput.focus();
}

function closePicker() {
  pickerPanel.classList.add('hidden');
  upgradePromptTarget = null;
}

async function onPickerDone() {
  closePicker();
  if (isFirstRun) {
    isFirstRun = false;
    await chrome.storage.local.set({ pickerSetupDone: true });
  }
  await chrome.storage.local.set({ trackedCoins });
  render(lastDetectedSymbol);
  if (!currentPayload) chrome.runtime.sendMessage({ type: 'FETCH_NOW' });
}

const LEVEL_ORDER = { Spiking: 0, Buzzing: 1, Active: 2, Quiet: 3 };

// Build sorted picker list from payload coins
function getSortedPickerCoins() {
  if (!currentPayload?.coins?.length) return [];
  const coins = currentPayload.coins.slice();
  if (pickerSort === 'alpha') {
    return coins.sort((a, b) => {
      const aT = trackedCoins.includes(a.symbol) ? 0 : 1;
      const bT = trackedCoins.includes(b.symbol) ? 0 : 1;
      if (aT !== bT) return aT - bT;
      return a.symbol.localeCompare(b.symbol);
    });
  }
  // Level sort: target level first, then the rest alphabetically
  const target = pickerSort.charAt(0).toUpperCase() + pickerSort.slice(1); // e.g. 'spiking' -> 'Spiking'
  return coins.sort((a, b) => {
    const aMatch = (a.chatter?.level === target) ? 0 : 1;
    const bMatch = (b.chatter?.level === target) ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    // Within same group: sort by level order, then alpha
    const aOrd = LEVEL_ORDER[a.chatter?.level] ?? 99;
    const bOrd = LEVEL_ORDER[b.chatter?.level] ?? 99;
    if (aOrd !== bOrd) return aOrd - bOrd;
    return a.symbol.localeCompare(b.symbol);
  });
}

function renderPickerList(filter) {
  const all = getSortedPickerCoins();
  const filtered = filter ? all.filter(c => c.symbol.startsWith(filter)) : all;

  if (!filtered.length) {
    coinListEl.innerHTML = '<p class="picker-empty">No coins match your search.</p>';
    return;
  }

  const activeCount = currentPayload?.active_coin_count ?? 0;
  var html = '';
  var upgradeInserted = false;

  filtered.forEach(coin => {
    const isChecked = trackedCoins.includes(coin.symbol);
    const isTarget = coin.symbol === upgradePromptTarget;

    html += '<div class="coin-row' + (isChecked ? ' coin-row-checked' : '') + '" data-symbol="' + esc(coin.symbol) + '">';
    html += '<label class="coin-row-label">';
    html += '<input type="checkbox" class="coin-checkbox" data-symbol="' + esc(coin.symbol) + '"' + (isChecked ? ' checked' : '') + ' />';
    html += '<span class="coin-row-symbol">' + esc(coin.symbol) + '</span>';
    html += '</label>';
    // Pro: show chatter level badge so users can identify active coins in the picker
    if (isPro && coin.chatter?.ok && coin.chatter.level) {
      html += '<span class="coin-row-badge ' + coin.chatter.level.toLowerCase() + '">' + esc(coin.chatter.level) + '</span>';
    }
    html += '</div>';

    if (isTarget && !upgradeInserted) {
      upgradeInserted = true;
      html += '<div class="upgrade-prompt" id="upgrade-prompt">' +
        'You\'re tracking 2 coins. <strong>Go Pro to track all 257</strong>' +
        ' &mdash; including <strong>' + activeCount + '</strong> currently active.' +
        ' <a href="#" class="upgrade-link">Upgrade &rarr;</a>' +
        '</div>';
    }
  });

  coinListEl.innerHTML = html;

  // Attach checkbox listeners after innerHTML injection
  coinListEl.querySelectorAll('.coin-checkbox').forEach(cb => {
    cb.addEventListener('change', () => handlePickerCheckbox(cb.dataset.symbol, cb.checked));
  });
}

function handlePickerCheckbox(symbol, wantsChecked) {
  if (!wantsChecked) {
    const i = trackedCoins.indexOf(symbol);
    if (i >= 0) trackedCoins.splice(i, 1);
    if (upgradePromptTarget === symbol) upgradePromptTarget = null;
    renderPickerList(pickerSearchInput.value.trim().toUpperCase());
    return;
  }

  // Free limit enforced in the click handler, not in storage
  if (!isPro && trackedCoins.length >= FREE_LIMIT) {
    upgradePromptTarget = symbol;
    renderPickerList(pickerSearchInput.value.trim().toUpperCase());
    const prompt = document.getElementById('upgrade-prompt');
    if (prompt) prompt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }

  trackedCoins.push(symbol);
  upgradePromptTarget = null;
  renderPickerList(pickerSearchInput.value.trim().toUpperCase());
}

// ── Card-area search bar ──────────────────────────────────────────────
function openSearch() {
  searchBar.classList.remove('hidden');
  searchBtn.classList.add('active');
  searchInput.value = '';
  closeSearchDropdown();
  searchInput.focus();
}

function closeSearch() {
  searchBar.classList.add('hidden');
  searchBtn.classList.remove('active');
  closeSearchDropdown();
  searchInput.value = '';
}

function closeSearchDropdown() {
  searchDropdown.classList.add('hidden');
  searchDropdown.innerHTML = '';
  searchHilIdx = -1;
}

function onSearchInput() {
  const q = searchInput.value.trim().toUpperCase();
  searchHilIdx = -1;
  if (!q) { closeSearchDropdown(); return; }

  const symbols = (currentPayload?.coins ?? []).map(c => c.symbol);
  const matches = symbols.filter(s => s.startsWith(q));
  if (!matches.length) { closeSearchDropdown(); return; }

  searchDropdown.innerHTML = matches
    .map(s => '<div class="search-item" data-coin="' + esc(s) + '">' + esc(s) + '</div>')
    .join('');
  searchDropdown.classList.remove('hidden');

  searchDropdown.querySelectorAll('.search-item').forEach((item, i) => {
    item.addEventListener('mousedown', e => { e.preventDefault(); selectSearchCoin(item.dataset.coin); });
    item.addEventListener('mouseenter', () => setSearchHighlight(i));
  });
}

function onSearchKeydown(e) {
  const items = searchDropdown.querySelectorAll('.search-item');
  if (e.key === 'Escape') { closeSearch(); return; }
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setSearchHighlight(Math.min(searchHilIdx + 1, items.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setSearchHighlight(Math.max(searchHilIdx - 1, 0));
  } else if (e.key === 'Enter' && searchHilIdx >= 0 && items[searchHilIdx]) {
    selectSearchCoin(items[searchHilIdx].dataset.coin);
  }
}

function setSearchHighlight(i) {
  const items = searchDropdown.querySelectorAll('.search-item');
  items.forEach(item => item.classList.remove('highlighted'));
  searchHilIdx = i;
  if (items[i]) {
    items[i].classList.add('highlighted');
    items[i].scrollIntoView({ block: 'nearest' });
  }
}

function selectSearchCoin(symbol) {
  const cards = getCards();
  const idx   = cards.findIndex(c => c.dataset.symbol === symbol);
  if (idx >= 0) showCard(idx);
  closeSearch();
}

// ── Time formatting ───────────────────────────────────────────────────
var MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(d) {
  return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate();
}

function fmtDateTime(d) {
  var h = d.getHours();
  var m = d.getMinutes();
  return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' +
    String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Parse a date string like "2026-03-19" as a local-time date (noon to avoid
// any DST edge at midnight).  Used for day/week bucket keys which represent
// calendar days and must not shift when displayed in local time.
function localDate(ymd) {
  return new Date(ymd + 'T12:00:00');
}

// Tooltip date label for a single bar
function formatBarDate(isoTs, mode, bucketKey) {
  try {
    if (mode === 'week' && bucketKey) {
      var parts = bucketKey.split('|');
      return fmtDate(localDate(parts[0])) + ' - ' + fmtDate(localDate(parts[1]));
    }
    if (mode === 'day' && bucketKey) {
      return fmtDate(localDate(bucketKey));
    }
    // cycle mode: show date + time in local timezone
    if (!isoTs) return '';
    return fmtDateTime(new Date(isoTs));
  } catch (_e) { return ''; }
}

// X-axis labels. posHint: 'first' or 'last' to pick start/end of week range.
function formatAxisDate(isoTs, mode, bucketKey, posHint) {
  try {
    if (mode === 'week' && bucketKey) {
      var idx = posHint === 'last' ? 1 : 0;
      return fmtDate(localDate(bucketKey.split('|')[idx]));
    }
    if (mode === 'day' && bucketKey) {
      return fmtDate(localDate(bucketKey));
    }
    if (!isoTs) return '';
    return fmtDate(new Date(isoTs));
  } catch (_e) { return ''; }
}

// ── HTML escape ───────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
