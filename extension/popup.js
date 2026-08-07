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

// ── Narrative cache ───────────────────────────────────────────────────
// Key: coin symbol. Cleared whenever pushed_at advances (new feed cycle).

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

  // Refresh on open unless the cache is seconds old. The previous condition was
  // `if (!currentPayload)`, so a STALE cache was never refreshed: the only path
  // left was the 5 minute background alarm, which does not fire while the machine
  // is asleep or the MV3 service worker is suspended. Measured 2026-08-04, with
  // every backend layer healthy (twscrape 51 min cadence, payload 1 min old,
  // endpoint no-cache): a client cache ~50 min old rendered as "1h 11 min ago",
  // because the age shown is cache age PLUS the coin's own cycle age.
  //
  // Opening the popup is the clearest signal the user wants current numbers.
  // background.js applies a 10s cooldown to FETCH_NOW, so reopening cannot spam.
  const payloadAgeMs = currentPayload?.pushed_at
    ? Date.now() - new Date(currentPayload.pushed_at).getTime()
    : Infinity;
  if (payloadAgeMs > 60_000) {
    chrome.runtime.sendMessage({ type: 'FETCH_NOW' }, () => void chrome.runtime.lastError);
  }
});

// ── React to new payload arriving from background service worker ──────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let needsRender = false;
  if (changes.lastPayload) {
    const newPayload = changes.lastPayload.newValue;
    currentPayload = newPayload;
    needsRender = true;
  }
  if (changes.trackedCoins) { trackedCoins   = changes.trackedCoins.newValue ?? []; needsRender = true; }  if (changes.isPro)        { isPro          = changes.isPro.newValue ?? false;      needsRender = true; }  if (needsRender) {
    render(lastDetectedSymbol);
    // Refresh picker list if it is currently open (e.g. payload arrived during first-run onboarding)
    if (pickerPanel && !pickerPanel.classList.contains('hidden')) {
      renderPickerList(pickerSearchInput ? pickerSearchInput.value.trim().toUpperCase() : '');
    }
  }
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

  // Zone A: clicking a busiest-now chip selects that coin in Zone B.
  const zoneUni = document.getElementById('zone-universe');
  if (zoneUni) {
    zoneUni.addEventListener('click', e => {
      const chip = e.target.closest('.uni-chip');
      if (!chip || !chip.dataset.symbol) return;
      const sym = chip.dataset.symbol;
      if (!trackedCoins.includes(sym)) {
        if (!isPro) return;                 // never reachable: free chips are not buttons
        trackedCoins = trackedCoins.concat([sym]);
        chrome.storage.local.set({ trackedCoins });
        render(lastDetectedSymbol);
      }
      selectSearchCoin(sym);
    });
  }

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
    // Trigger a fetch if the background hasn't cached a payload yet
    if (!currentPayload) chrome.runtime.sendMessage({ type: 'FETCH_NOW' }, () => void chrome.runtime.lastError);
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
    var sp = coin?.spark;
    if (!sp?.v?.length) return;
    var agg = SparklineCore.aggregateSparkline(sp.v, sp.tone, sparkTimestamps(sp), tf, { posArr: sp.pos, negArr: sp.neg, cycleMinutes: currentPayload?.cycle_minutes_approx, windowDays: CYCLE_DAYS });
    var wrap = card.querySelector('.sparkline-chart-wrap');
    if (wrap) setHTML(wrap, buildSparklineBarsHtml(agg.vals, agg.tones, agg.stamps, tf, agg.keys, agg.pos, agg.neg));
  }, true);

  footerBrandLink.addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://pulse.instrumetriq.com' });
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
    setHTML(sparkTip, text.replace(/\n/g, '<br>'));
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

// ── Detect the coin on the active tab from its URL ────────────────────
// activeTab (granted when the user clicks the icon) exposes tab.url; the
// parsing happens locally via extractSymbol (content.js, loaded by popup.html).
// Nothing is injected into the page.
async function queryContentScript() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    return extractSymbol(tab.url);
  } catch (_e) {
    return null; // not a supported page - silent
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
// ── Zone A: the universe ──────────────────────────────────────────────
// Renders with ZERO tracked coins. Looking up one coin is uneventful most of the
// time; "what is loud across 278 coins" never is. This is what makes the popup
// worth opening when every tracked coin is quiet.
function renderUniverse() {
  const el = document.getElementById('zone-universe');
  if (!el) return;
  const u = currentPayload?.universe;
  if (!u) { el.innerHTML = ''; return; }

  var html = '';

  // Market pulse - a trailing DAILY average, never the latest cycle. It moves
  // ~1.4 points a day, so it reads as ambient context, not a headline.
  const mk = u.market;
  if (mk && mk.value != null) {
    const rank = mk.pct_rank;
    // Show only the RELATIVE reading. The absolute share sits in a narrow band
    // (64-76% over 30 days), so printing "66% positive" beside "more negative
    // than usual" reads as a contradiction even though both are true.
    const mood = rank >= 80 ? 'much busier with positive talk than usual'
               : rank >= 60 ? 'more positive than usual'
               : rank >= 40 ? 'about as positive as usual'
               : rank >= 20 ? 'less positive than usual'
               : 'much less positive than usual';
    html += '<div class="uni-row uni-market" data-tooltip="' +
      esc('Across all tracked coins, how positive the conversation is today compared with the last ' +
          mk.days + ' days. Sits in the ' + rank + 'th percentile of that window. ' +
          'Describes the mood of the conversation, not the market.') + '">' +
      '<span class="uni-label">Market conversation</span>' +
      '<span class="uni-value">' + esc(mood) + '</span>' +
    '</div>';
  }

  // Loudest right now - gated on an absolute post floor so it cannot fill with
  // one-post microcaps.
  if (u.loudest && u.loudest.length) {
    const chips = u.loudest.slice(0, 5).map(function (d) {
      const tracked   = trackedCoins.includes(d.symbol);
      const canAct    = tracked || isPro;   // Pro can add; free can only view what it tracks
      // Colour by the SAME band the card uses, so a chip and the coin's own
      // scale strip always agree. `d.state` only distinguishes spike, which left
      // busy and steady coins rendering identically in plain white.
      const band      = attentionBand(d.ratio);
      const hot       = band ? ' state-' + band.toLowerCase() : '';
      const base      = d.symbol + ' · ' + d.ratio.toFixed(1) + '× its usual accounts, '
                      + d.posts + ' posts';
      const tip = tracked ? base + '. Click to view.'
                : isPro   ? base + '. Click to track it.'
                          : base + '.';
      if (!canAct) {
        return '<span class="uni-chip static' + hot + '" data-tooltip="' + esc(tip) + '">' +
               esc(d.symbol) + '</span>';
      }
      return '<button class="uni-chip' + hot + '" data-symbol="' + esc(d.symbol) +
             '" data-tooltip="' + esc(tip) + '">' + esc(d.symbol) + '</button>';
    }).join('');
    html += '<div class="uni-row uni-loud">' +
      '<span class="uni-label" data-tooltip="' +
        esc('Coins with the most unusual posting activity relative to their own recent norm.') +
        '">Busiest now</span>' +
      '<span class="uni-chips">' + chips + '</span>' +
    '</div>';
  }

  html += '<div class="uni-row uni-stats">' +
    '<span class="uni-stat">' + u.coins_tracked + ' coins · ' + u.active_coins + ' active</span>' +
    // "86 busier than usual" read as a dropped word. The subject is coins, and
    // the strip has room to say so.
    (u.busy ? '<span class="uni-stat">' + u.busy +
       (u.busy === 1 ? ' coin' : ' coins') + ' busier than usual</span>' : '') +
    // Was a ternary with both branches identical, so it never varied. "unusual"
    // is an adjective here and does not inflect; the count carries the number.
    (u.spiking ? '<span class="uni-stat uni-hot">' + u.spiking + ' unusual</span>' : '') +
  '</div>';

  setHTML(el, html);
}

function render(detectedSymbol) {
  renderUniverse();

  if (!currentPayload) {
    cardAreaEl.innerHTML = '<p class="no-data-msg">Loading data...</p>';
    updateStatusBar(null);   // no coin on screen, so no freshness stamp
    return;
  }

  if (!currentPayload.feed_ok) {
    cardAreaEl.innerHTML =
      '<div class="feed-banner">' +
        '<p class="feed-banner-msg">Data temporarily unavailable. ' +
        'The extension will recover automatically.</p>' +
      '</div>';
    updateStatusBar(null);
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

  // Normal cards for tracked coins (Pro: sorted by attention).
  // Sorts on the CONTINUOUS ratio, never the spike boolean - the boolean fires on
  // ~1% of coin-cycles, so sorting by it would collapse the ordering and make the
  // Pro sort worse than the four buckets it replaced.
  const effectiveTracked = isPro ? trackedCoins.slice() : trackedCoins.slice(0, FREE_LIMIT);
  if (isPro) {
    effectiveTracked.sort((a, b) => {
      const ra = coinMap[a]?.attention?.ratio ?? -1;
      const rb = coinMap[b]?.attention?.ratio ?? -1;
      if (rb !== ra) return rb - ra;
      return a.localeCompare(b);
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

  setHTML(cardAreaEl, specs.map((s, i) =>
    buildCardHtml(s, i === 0 ? 'active-card' : 'hidden-card')
  ).join(''));

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
  const isHot = coin?.attention?.state === 'spike';
  const badgeHtml = isHot
    ? '<span class="level-badge spike">UNUSUAL ATTENTION</span>'
    : '';
  const canAdd = isPro || trackedCoins.length < FREE_LIMIT;
  var ctaText;
  if (canAdd) {
    ctaText = isHot
      ? esc(symbol) + ' is getting unusual attention. '
      : '';
    ctaText += '<a href="#" class="teaser-add-link" data-symbol="' + esc(symbol) + '">Add ' + esc(symbol) + ' to your tracked coins.</a>';
  } else {
    ctaText = isHot
      ? esc(symbol) + ' is getting unusual attention. '
      : '';
    ctaText += '<a href="#" class="upgrade-link">Go Pro to track ' + esc(symbol) + ' and all 270+ coins.</a>' +
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

// ── Activity bands ────────────────────────────────────────────────────
// v1 had four visual states off the Engagement Coefficient. EC is retired, but
// the gradation was useful - two states (spike / not spike) throws away the
// middle. These band the CONTINUOUS attention ratio instead, so the scale and
// the badge come from the same number.
//   Quiet   < 0.5x its own normal
//   Steady  0.5x - 1.5x
//   Busy    1.5x - 6x
//   Unusual >= 6x   (the published spike threshold)
const ATTN_BANDS = ['Quiet', 'Steady', 'Busy', 'Unusual'];

// One short line for the footer, whatever the universe is doing. Falls back from
// unusual to busy to a plain count so the string never grows long enough to wrap.
function universeHeadline(spiking) {
  const busy = currentPayload?.universe?.busy ?? 0;
  const tracked = currentPayload?.universe?.coins_tracked ?? 0;
  if (spiking > 0) {
    return spiking + (spiking === 1 ? ' coin has' : ' coins have') + ' unusual activity.';
  }
  if (busy > 0) {
    return busy + (busy === 1 ? ' coin is' : ' coins are') + ' busier than usual.';
  }
  return tracked ? 'Tracking ' + tracked + ' coins.' : 'Tracking 270+ coins.';
}

function attentionBand(ratio) {
  if (ratio == null) return null;
  if (ratio >= 6)   return 'Unusual';
  if (ratio >= 1.5) return 'Busy';
  if (ratio >= 0.5) return 'Steady';
  return 'Quiet';
}

function buildScaleHtml(band) {
  const tips = {
    Quiet:   'Fewer accounts posting than\nusual for this coin',
    Steady:  'About as many accounts as\nusual for this coin',
    Busy:    'Noticeably more accounts\nposting than usual',
    Unusual: 'At least 6x its usual number\nof posting accounts'
  };
  var inner = '';
  ATTN_BANDS.forEach(function (s, i) {
    inner += '<span class="scale-step' + (s === band ? ' current' : '') +
             '" data-tooltip="' + tips[s] + '">' + s + '</span>';
    if (i < ATTN_BANDS.length - 1) inner += '<span class="scale-divider">&#x203A;</span>';
  });
  return '<div class="level-scale">' + inner + '</div>';
}

function buildNormalCardHtml(coin, visClass) {
  const sym   = coin.symbol;
  const state = coin.attention?.state || null;
  const band  = attentionBand(coin.attention?.ratio);
  const stCls = band ? 'state-' + band.toLowerCase() : '';

  // Only a genuine spike earns a badge. It fires on ~1% of coin-cycles, which is
  // exactly what makes it worth showing.
  //
  // The tooltip describes POSTING ONLY. An earlier version tied this reading to
  // market behaviour. Hedging such a sentence does not undo the link it draws,
  // and it was the one place the extension connected a social count to anything
  // outside the conversation. Keep this text about posting.
  const badgeHtml = state === 'spike'
    ? '<span class="level-badge spike" data-tooltip="' +
        esc('Unusually many accounts are posting about this coin, at least 6x its own recent median. That describes the conversation, not the price.') +
        '">UNUSUAL</span>'
    : '';

  return '<div class="card ' + stCls + ' ' + visClass + '" data-symbol="' + esc(sym) + '">' +
    '<div class="card-header">' +
      '<span class="coin-symbol">' + esc(sym) + '</span>' +
      badgeHtml +
    '</div>' +
    buildScaleHtml(band) +
    buildSparklineHtml(coin) +
    '<div class="data-rows">' + buildRowsHtml(coin) + '</div>' +
    // Disclaimer and freshness stamp now live in the fixed .status-bar above the
    // footer, not here, so they cannot be pushed out by tall card content.
    (buildXLink(sym, band) ? '<div class="card-footer-row card-footer-link">' + buildXLink(sym, band) + '</div>' : '') +
  '</div>';
}

function buildSparklineBarsHtml(vals, tones, stamps, mode, bucketKeys, posArr, negArr) {
  var logVals = vals.map(function (v) { return Math.log1p(v); });
  var logMax  = Math.max.apply(null, logVals);
  var logMean = logVals.reduce(function (a, b) { return a + b; }, 0) / logVals.length;
  var avgPct  = logMax > 0 ? Math.round((logMean / logMax) * 100) : 0;
  // 13 = .y-axis padding-bottom, 0.52 = .sparkline height 52px / 100.
  // Both are mirrored from popup.css; if the chart height changes, change all
  // three together or the Avg label drifts off the dashed baseline.
  // Clamped so it cannot collide with the fixed High and Low labels. A coin whose
  // bars sit consistently near its own max has avgPct in the 90s (OM: 92), which
  // put "Avg" at 61px against "High" at ~65 and printed the two on top of each
  // other. 11px of clearance either end keeps the 10px labels apart.
  // The Avg LABEL must sit on the Avg LINE, which is drawn at `bottom: avgPct%`
  // of the bars. Clamping the label to avoid a collision detaches it from the
  // line it names, which trades one defect for another.
  //
  // Geometry: y-axis box = 52px bars + 13px padding = 65px; "High" is the top
  // flex item (bottom 55..65), "Low" the bottom one (bottom 13..23); "Avg" is
  // absolute and 10px tall, so its top is bottom+10.
  //
  // When the mean sits near the max, High and Avg mark the SAME place and
  // printing both is meaningless as well as unreadable (OM: avgPct 92). So the
  // colliding endpoint label is dropped and Avg keeps its true position.
  var avgLabelBottom = (13 + Math.round(avgPct * 0.52)) + 'px';
  var avgTop = 13 + Math.round(avgPct * 0.52) + 10;
  var showHigh = avgTop <= 55;                       // Avg clears "High"
  var showLow  = 13 + Math.round(avgPct * 0.52) >= 23; // Avg clears "Low"

  var bars = '';
  vals.forEach(function (v, i) {
    var h = logMax > 0 ? Math.round((logVals[i] / logMax) * 100) : 0;
    var t = SparklineCore.toneClass(tones && tones[i]);
    // Bars plot distinct_authors_total, so the tooltip says accounts. It read
    // "EC 63", the v1 Engagement Coefficient, which this has not been since the
    // v2 rebuild: 63 is a count of accounts, not a weighted engagement score.
    var nFmt = v >= 1000 ? Math.round(v).toLocaleString() : String(Math.round(v));
    var ecLbl = v <= 0 ? 'No posts'
              : nFmt + (Math.round(v) === 1 ? ' account' : ' accounts');
    if (mode === 'day')  ecLbl += ', daily average';
    if (mode === 'week') ecLbl += ', weekly average';
    var dateLbl = SparklineCore.formatBarDate(stamps && stamps[i], mode, bucketKeys && bucketKeys[i]);
    var toneLbl = '';
    if (tones && tones[i] != null) {
      // "Shift" was v1, where tone moved against a rolling baseline. This value
      // is positive share minus negative share for the period, a balance rather
      // than a movement.
      toneLbl = 'Net tone ' + (tones[i] > 0 ? '+' : '') + tones[i];
    }
    var tipLines = [ecLbl];
    if (toneLbl) tipLines.push(toneLbl);
    if (dateLbl) tipLines.push(dateLbl);
    var tip = tipLines.map(esc).join('\n');
    bars += '<div class="spark-bar ' + t + '" style="height:' + h + '%" data-tooltip="' + tip + '"></div>';
  });

  var firstLabel = SparklineCore.formatAxisDate(stamps && stamps[0], mode, bucketKeys && bucketKeys[0], 'first');
  var lastLabel  = SparklineCore.formatAxisDate(stamps && stamps[stamps.length - 1], mode, bucketKeys && bucketKeys[bucketKeys ? bucketKeys.length - 1 : 0], 'last') || 'Now';

  return '<div class="sparkline-chart">' +
    '<div class="y-axis">' +
      '<span class="y-label">' + (showHigh ? 'High' : '') + '</span>' +
      '<span class="y-label y-avg" style="bottom:' + avgLabelBottom + '">Avg</span>' +
      '<span class="y-label">' + (showLow ? 'Low' : '') + '</span>' +
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

// Rehydrate the v2 spark encoding: a base timestamp plus integer minute
// offsets, instead of one ISO string per point. That encoding is what took the
// payload from 3.69 MB to 1.75 MB.
var CYCLE_DAYS = 7; // rolling 7-day window for per-cycle bars

function sparkTimestamps(sp) {
  if (!sp || !sp.t0 || !sp.dt) return null;
  var base = new Date(sp.t0.replace('Z', '+00:00')).getTime();
  return sp.dt.map(function (m) {
    return new Date(base + m * 60000).toISOString().slice(0, 16) + 'Z';
  });
}

function buildSparklineHtml(coin) {
  var sp   = coin.spark;
  var sl   = sp?.v;
  var tone = sp?.tone;
  var ts   = sparkTimestamps(sp);

  // Decide the mode BEFORE building the header, so the highlighted button and
  // the bars drawn can never disagree.
  //
  // Day by default, because every row below the chart is a 24h figure. A
  // per-cycle newest bar beside 24h rows is what produced "mostly positive"
  // next to a red candle. C is still one click away for the live view.
  var mode = 'day';
  var cycleMin = Math.round((currentPayload?.cycle_minutes_approx ?? 50) / 5) * 5;
  var headerHtml =
    '<div class="sparkline-header">' +
      '<span class="sparkline-label" data-tooltip="How many distinct accounts posted about this coin.&#10;Each bar is one day by default. Use the buttons to switch between per-update, daily and weekly bars.&#10;Taller bars = more accounts posting.&#10;Colour shows the tone of those posts.">Posting activity</span>' +
      '<div class="sparkline-controls">' +
        '<div class="sparkline-tf">' +
          '<button class="tf-btn' + (mode === 'cycle' ? ' active' : '') + '" data-tf="cycle" ' +
            'data-tooltip="One bar per update, the freshest view, about every ' + cycleMin + ' minutes.">' + cycleMin + 'm</button>' +
          '<button class="tf-btn' + (mode === 'day'   ? ' active' : '') + '" data-tf="day" ' +
            'data-tooltip="One bar per day, over the last 30 days.">Day</button>' +
          '<button class="tf-btn" data-tf="week" ' +
            'data-tooltip="One bar per week, over the last 4 weeks.">Week</button>' +
        '</div>' +
        '<div class="sparkline-legend" data-tooltip="Bar colour shows the tone of those posts: green above this coin\u2019s usual level, red below, grey near it.">' +
          '<span class="legend-dot positive"></span>' +
          '<span class="legend-dot negative"></span>' +
          '<span class="legend-dot mixed"></span>' +
        '</div>' +
      '</div>' +
    '</div>';

  if (!sl?.length) {
    return headerHtml +
      '<div class="sparkline-chart sparkline-empty">' +
        '<span class="sparkline-no-data">Not enough data yet</span>' +
      '</div>';
  }

  // Day by default: at cycle granularity only ~26% of coins clear the 5-post
  // threshold, versus ~77% at day level. Spiking coins switch to Cycle, where
  // the finer granularity is the point.
  var agg = SparklineCore.aggregateSparkline(sl, tone, ts, mode, { posArr: sp.pos, negArr: sp.neg, cycleMinutes: currentPayload?.cycle_minutes_approx, windowDays: CYCLE_DAYS });
  var barsHtml = buildSparklineBarsHtml(agg.vals, agg.tones, agg.stamps, mode, agg.keys, agg.pos, agg.neg);

  return headerHtml + '<div class="sparkline-chart-wrap">' + barsHtml + '</div>';
}

// ── Data rows ─────────────────────────────────────────────────────────
// ── Zone B data rows (v2) ─────────────────────────────────────────────
// Every row is DESCRIPTIVE. Nothing states or implies a price direction: tone
// describes what posts say, attention describes how many people are posting.
function buildRowsHtml(coin) {
  var html = '';

  const att = coin.attention;
  if (!att || att.ratio == null) {
    html += reasonRow('Latest update',
      'How many accounts posted in the most recent update window, against this coin\u2019s own recent normal.',
      coin, 'attention');
  }
  if (att && att.ratio != null) {
    const r = att.ratio;
    // A silent cycle is an absence, not a measurement. "0.0x usual" would read as
    // a reading; "no posts" says what actually happened.
    const val = att.silent
      ? 'no posts'
      : (r >= 10 ? Math.round(r) : r.toFixed(1)) + '× usual';
    // Coloured by BAND, matching the scale strip above, the chips in the universe
    // row and the card's left rail. Keying on `att.state` meant a coin at 5.0x
    // came back "intermediate" and rendered plain white while the strip beside it
    // highlighted "Busy" in cyan.
    const attnBand = attentionBand(r);
    const cls = att.silent ? 'attn-none'
      : (attnBand ? 'attn-' + attnBand.toLowerCase() : '');
    // Same source as the status bar's stamp, so the two can never disagree.
    const age = formatAgo(coinAgeMin(coin)) || 'latest update';
    // "Latest update", not "Right now": the value is from the most recent
    // completed sweep, which the age beside it says is minutes old. Claiming
    // "right now" beside "18 min ago" contradicts itself on the same line.
    html += '<div class="data-row row-live">' +
      '<span class="row-label" data-tooltip="' +
        esc('How many accounts posted in the most recent update window, against this coin\u2019s own recent normal. This is the freshest reading we have, everything below it covers the last 24 hours.') +
      '">Latest update <span class="row-age">' + esc(age) + '</span></span>' +
      '<span class="row-value ' + cls + '" data-tooltip="' +
        esc(att.silent
            ? 'Nobody posted about this coin in the most recent update window. The rows below still cover the last 24 hours.'
            : att.pct_rank != null
            ? 'Busier than ' + att.pct_rank + '% of the coins we track in this update.'
            : 'Compared with this coin\u2019s own recent average.') +
      '">' + esc(val) + '</span>' +
    '</div>';
  }
  // Emitted once, outside both branches: it labels the rows BELOW it, so it is
  // correct whether or not the live row above it could be filled.
  html += '<div class="rows-divider"><span>Last 24 hours</span></div>';

  const tone = coin.tone;
  if (!tone) {
    html += reasonRow('Tone of posts',
      'How positive or negative the posts were, over the last 24 hours.',
      coin, 'tone');
  }
  if (tone) {
    const cls = tone.pos - tone.neg >= 10 ? 'tone-positive'
              : (tone.neg - tone.pos >= 10 ? 'tone-negative' : 'tone-neutral');
    html += dataRow('Tone of posts',
      'The mix of positive, neutral and negative language across the last 24 hours.',
      tone.label + ' · ' + tone.pos + '/' + tone.neu + '/' + tone.neg,
      tone.pos + '% positive, ' + tone.neu + '% neutral and ' + tone.neg
        + '% negative, across ' + tone.posts + ' posts in the last 24 hours.',
      cls);
  }

  // Outside the tone branch: conviction is a separate measurement that can exist
  // when tone does not, so nesting it hid a value we actually had.
  const CONV_LABEL = { consistent: 'clear', split: 'mixed', contested: 'unclear' };
  const CONV_TIP = {
    consistent: 'Most posts leaned the same way, so the tone reading is a fair summary.',
    split: 'Opinion was divided, with strongly positive and strongly negative posts and little in between.',
    contested: 'Posts pulled in different directions, so treat the tone above as a rough summary.'
  };
  if (coin.conviction) {
    html += dataRow('How clear-cut',
      'Whether posts mostly agreed with each other, or were all over the place.',
      CONV_LABEL[coin.conviction], CONV_TIP[coin.conviction] || '');
  } else {
    html += reasonRow('How clear-cut',
      'Whether posts mostly agreed with each other, or were all over the place.',
      coin, 'conviction');
  }

  // Topics: what is DISCUSSED. Deliberately NOT framed as explaining the tone -
  // they come from different classifiers and ~65% of scored posts contain no
  // category vocabulary at all, which is why coverage is shown.
  const tp = coin.topics;
  if (!tp || !tp.items || !tp.items.length) {
    html += reasonRow('Discussed',
      'The topics people raised: hype, fear, scam talk, memes.',
      coin, 'topics');
  }
  if (tp && tp.items && tp.items.length) {
    // Each topic carries its OWN tooltip with the full word list. Inlining the
    // words made the row wrap and skew, and only ever showed one of them.
    const parts = tp.items.map(function (it) {
      const head = it.label.charAt(0).toUpperCase() + it.label.slice(1)
                 + ', ' + it.count + (it.count === 1 ? ' mention' : ' mentions') + '.';
      // Not every matched word is available to display: the counts come from a
      // much larger vocabulary than the sample of words we can show.
      //
      // "Examples" is load-bearing, do not change it to "Top words" or "Most
      // common". The builder collapses inflections of one stem (OP returned
      // optimism / with optimism / love the optimism / optimism about / some
      // optimism, five slots for one word), so these are five distinct words
      // drawn from the top matches, not the five most frequent. Every word shown
      // is a real match and the count includes all of them, so "Examples" is
      // true; a ranking claim would not be.
      const words = (it.terms && it.terms.length)
        ? ' Examples: ' + it.terms.join(', ') + '.'
        : '';
      return '<span class="topic-tag' + (it.terms && it.terms.length ? '' : ' no-terms') +
        '" data-tooltip="' + esc(head + words) + '">' + esc(it.label) + '</span>';
    });
    const tip = 'Topic words spotted across ' + tp.total_posts + ' posts in the last '
      + '24 hours, using a curated crypto vocabulary. Hover each topic for the words '
      + 'behind it. Separate from tone, a positive conversation can still discuss risks.';
    html += '<div class="data-row topics-row">' +
      '<span class="row-label" data-tooltip="' + esc(tip) + '">Discussed</span>' +
      '<span class="row-value topics-value">' + parts.join('<span class="topic-sep"> · </span>') + '</span>' +
    '</div>';
  }

  const cr = coin.crowd;
  if (!cr) {
    html += reasonRow('Who\u2019s posting',
      'Distinct accounts posting about this coin in the last 24 hours.',
      coin, 'crowd');
  }
  if (cr) {
    var who = cr.authors + (cr.authors === 1 ? ' account' : ' accounts');
    // "at least", because verified accounts cannot be de-duplicated across
    // updates: this is the busiest single update's count, a lower bound on the
    // day. The plain account count beside it IS a true 24h figure.
    if (cr.blue) who += ' \u00B7 ' + cr.blue + '+ verified';
    var whoTip = 'Distinct accounts posting in the last 24 hours.';
    if (cr.blue) {
      whoTip += ' At least ' + cr.blue + ' were verified, counted from the busiest'
             + ' single update, so the true figure over the day may be higher.';
    }
    html += dataRow('Who\u2019s posting',
      'Distinct accounts posting about this coin in the last 24 hours.', who, whoTip);
  }

  // One quantity, one comparison. The earlier version showed "30 posts from 21
  // · below usual" and then a tooltip quoting a THIRD number (72), which read as
  // three unrelated figures.
  const ac = coin.activity;
  if (ac) {
    var v = ac.posts + (ac.posts === 1 ? ' post' : ' posts');
    if (ac.usual != null) v += ' · usually ' + ac.usual;
    html += dataRow('Posts',
      'Posts about this coin in the last 24 hours, next to what is normal for it.',
      v,
      ac.usual != null
        ? 'This coin averages about ' + ac.usual + ' posts a day over the past two weeks.'
        : 'We only compare against days measured the same way as today. How posts '
          + 'are matched to coins changed recently, so there is not yet enough '
          + 'comparable history to say what is normal here.',
      ac.relative === 'below' ? 'muted' : '');
  }

  const mk = coin.market;
  if (mk) {
    if (mk.volume_fmt) {
      html += dataRow('Volume', 'Traded value over the last 24 hours.',
        mk.volume_fmt + (mk.volume_label ? ' · ' + mk.volume_label : ''),
        mk.volume_label ? mk.volume_label + ' compared with the other tracked coins.' : '');
    }
    // Two different questions: chg is which way it went, range is how far it
    // swung between its high and low. A coin can end flat after a 12% swing, so
    // neither number can be derived from the other. Colour comes from chg only,
    // because range has no sign to colour. Market facts, stated as such: nothing
    // here is tied to the sentiment rows above.
    if (mk.chg_pct_24h != null || mk.range_pct_24h != null) {
      var pv = '', ptip = '';
      if (mk.chg_pct_24h != null) {
        var up = mk.chg_pct_24h > 0, flat = mk.chg_pct_24h === 0;
        pv = '<span class="' + (flat ? '' : (up ? 'px-up' : 'px-down')) + '">' +
             (up ? '+' : '') + mk.chg_pct_24h.toFixed(1) + '%</span>';
        ptip = flat
          ? 'Price is level with 24 hours ago.'
          : 'Price is ' + (up ? 'up' : 'down') + ' ' +
            Math.abs(mk.chg_pct_24h).toFixed(1) + '% against 24 hours ago.';
      }
      if (mk.range_pct_24h != null) {
        pv += (pv ? '<span class="topic-sep"> · </span>' : '') +
              esc(mk.range_pct_24h.toFixed(1) + '% swing');
        ptip += (ptip ? ' ' : '') + 'Its high and low over those 24 hours were ' +
                mk.range_pct_24h.toFixed(1) + '% apart.';
      }
      html += '<div class="data-row">' +
        '<span class="row-label" data-tooltip="' +
          esc('Change since 24 hours ago, and how far the price swung between its high and low in that time. Market data, shown for context.') +
        '">Price</span>' +
        '<span class="row-value" data-tooltip="' + esc(ptip) + '">' + pv + '</span>' +
      '</div>';
    }
  }

  return html;
}

// A row explaining why a reading is unavailable, in place of silently dropping it.
// Muted so it reads as an absence rather than a value.
const REASON_TEXT = {
  'tone:too_few_posts': ['not enough posts',
    'Tone needs at least 5 scored posts over 24 hours. This coin had fewer, and a couple of posts cannot describe a mood.'],
  'tone:unclear': ['unclear',
    'Posts were scored but split too evenly to call either way.'],
  'topics:no_posts': ['no posts',
    'Nobody posted about this coin in the last 24 hours, so there is nothing to categorise.'],
  'topics:no_matches': ['nothing recognised',
    'People posted, but used none of the words in our curated crypto vocabulary.'],
  'crowd:no_authors': ['nobody posted',
    'No accounts posted about this coin in the last 24 hours.'],
  'attention:no_baseline': ['too rarely discussed',
    'We compare each update against this coin\u2019s own normal, which needs at least 5 earlier updates that had any posts at all. This coin has had fewer than that in a month.'],
  'conviction:too_few_posts': ['not enough posts',
    'This needs at least 5 scored posts over 24 hours, the same as tone. Below that we have not measured agreement, so calling it mixed or unclear would claim more than we know.']
};

function reasonRow(label, labelTip, coin, key) {
  const code = (coin.reasons || {})[key];
  if (!code) return '';
  const t = REASON_TEXT[key + ':' + code];
  if (!t) return '';
  return dataRow(label, labelTip, t[0], t[1], 'na');
}

function dataRow(label, labelTip, value, valueTip, extraClass) {
  return '<div class="data-row">' +
    '<span class="row-label" data-tooltip="' + esc(labelTip) + '">' + esc(label) + '</span>' +
    '<span class="row-value' + (extraClass ? ' ' + extraClass : '') + '" data-tooltip="' + esc(valueTip) + '">' + esc(value) + '</span>' +
  '</div>';
}

// Shown for Busy and Unusual coins. Keyed on the BAND, not spike_state: a coin at
// 4.3x its usual accounts is well worth reading, and gating on `state === 'spike'`
// hid the link for everything below 6x. Steady and Quiet keep no link, since
// there is little to go and read.
function buildXLink(sym, band) {
  if (band !== 'Busy' && band !== 'Unusual') return '';
  const href = 'https://x.com/search?q=%24' + encodeURIComponent(sym) + '&src=typed_query&f=live';
  return '<a class="x-link" href="' + href + '" target="_blank" rel="noopener">See what\'s being said &#x2192;</a>';
}

// Minutes since this coin's latest cycle closed, measured LIVE.
//
// `updated_ago_min` is frozen at payload build time, so rendering it raw drifts
// from anything that recomputes against Date.now(). That is exactly what made the
// card show "Latest update 14 min ago" beside "updated 17 min ago" in the status
// bar: one source, one cycle, two renderings, differing by the payload's own age.
// Every age on screen now comes from this one function.
function coinAgeMin(coin) {
  const agoAtBuild = coin?.updated_ago_min;
  if (agoAtBuild == null || !currentPayload?.pushed_at) return null;
  const pushedMs = new Date(currentPayload.pushed_at).getTime();
  const lastSeenMs = pushedMs - agoAtBuild * 60000;
  return Math.max(0, Math.round((Date.now() - lastSeenMs) / 60000));
}

function formatAgo(min) {
  if (min == null) return '';
  if (min < 60) return min + ' min ago';
  const hr = Math.floor(min / 60), rem = min % 60;
  return rem ? hr + 'h ' + rem + ' min ago' : hr + 'h ago';
}

function buildUpdatedAgo(coin) {
  const min = coinAgeMin(coin);
  return min == null ? '' : 'updated ' + formatAgo(min);
}

// The AI narrative was removed in v2 (decision 2026-07-27). It was generated
// server-side from the `chatter` AND `futures` blocks and told to interpret "the
// derivatives signals as a whole" - with futures gone it had no inputs. Its two
// cache layers are cleared on upgrade by migrateToV2() in background.js.














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
  const sym = cards[currentCardIdx]?.dataset.symbol ?? '';
  if (coinNameEl) coinNameEl.textContent = sym;
  if (counterEl)  counterEl.textContent  = (currentCardIdx + 1) + ' / ' + cards.length;
  updateStatusBar(sym);
}

// The status bar is outside .card-area and so is not rebuilt with the cards.
// It has to be refreshed whenever the visible coin changes, since the freshness
// stamp is per coin.
function updateStatusBar(sym) {
  const el = document.getElementById('status-updated');
  if (!el) return;
  const coin = (currentPayload?.coins ?? []).find(c => c.symbol === sym);
  el.textContent = coin ? buildUpdatedAgo(coin) : '';

  // Mirror the card's state class so the left accent rail runs unbroken from the
  // card into the bar instead of stopping with a 3px notch.
  const bar = el.closest('.status-bar');
  if (!bar) return;
  const band = coin ? attentionBand(coin.attention?.ratio) : null;
  bar.className = 'status-bar' + (band ? ' state-' + band.toLowerCase() : '');
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
  chrome.runtime.sendMessage({ type: 'FETCH_NOW' }, () => void chrome.runtime.lastError); // prompt SW to re-evaluate badge
}

async function onRefreshClick() {
  refreshBtn.classList.add('spinning');
  refreshBtn.classList.add('cooldown');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'FETCH_NOW' }, () => void chrome.runtime.lastError);
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

// `notifications` is an OPTIONAL permission in v2, so it is not requested at
// install - it is requested here, in context, the first time someone turns alerts
// on. Users who never enable alerts never see the prompt.
//
// Denial must leave the toggle OFF and storage untouched. A half-enabled state
// (flag true, permission absent) would silently drop every alert.
async function onAlertsToggle() {
  const sw = document.querySelector('.switch-toggle');
  const turningOn = !notificationsEnabled;

  if (turningOn && chrome.permissions) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ permissions: ['notifications'] });
    } catch (_e) {
      granted = false;
    }
    if (!granted) {
      sw.classList.add('off');
      sw.classList.remove('on');
      notificationsEnabled = false;
      await chrome.storage.local.set({ notificationsEnabled: false });
      return;
    }
  }

  notificationsEnabled = turningOn;
  sw.classList.toggle('on',  notificationsEnabled);
  sw.classList.toggle('off', !notificationsEnabled);
  await chrome.storage.local.set({ notificationsEnabled });
}

// ── Footer ────────────────────────────────────────────────────────────
function updateFooter() {
  if (!currentPayload) return;
  const coins = currentPayload.coins || [];
  const n = currentPayload?.universe?.spiking ?? 0;

  if (isPro) {
    if (footerActiveCountEl) {
      footerActiveCountEl.textContent = universeHeadline(n);
    }
    if (footerCtaEl)     { footerCtaEl.textContent = 'Pro plan active'; footerCtaEl.style.pointerEvents = 'none'; }
    if (footerRestoreEl) footerRestoreEl.classList.add('hidden');
    return;
  }

  // Keep this SHORT and roughly constant in length. The old zero-state read
  // "Track all 270+ coins and get alerted when one gets busy.", which wrapped to
  // two lines and shoved the right-hand footer column out of place, and it now
  // shows often because a silent latest cycle can no longer report a spike.
  if (footerActiveCountEl) {
    footerActiveCountEl.textContent = universeHeadline(n);
  }
  // Constant text: swapping to "Go Pro" changed the column width whenever the
  // unusual count crossed zero, which moved the links beside it.
  if (footerCtaEl) {
    footerCtaEl.textContent = 'Unlock all 270+ \u2192';
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
  if (!currentPayload) chrome.runtime.sendMessage({ type: 'FETCH_NOW' }, () => void chrome.runtime.lastError);
}


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
  // Activity sort (Pro): continuous attention ratio, descending.
  return coins.sort((a, b) => {
    const ra = a.attention?.ratio ?? -1;
    const rb = b.attention?.ratio ?? -1;
    if (rb !== ra) return rb - ra;
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
    // Pro: flag unusual attention so active coins are findable in the picker
    if (isPro && coin.attention?.state === 'spike') {
      html += '<span class="coin-row-badge spike">Unusual</span>';
    }
    html += '</div>';

    if (isTarget && !upgradeInserted) {
      upgradeInserted = true;
      html += '<div class="upgrade-prompt" id="upgrade-prompt">' +
        'You\'re tracking 2 coins. <strong>Go Pro to track all 270+</strong>' +
        ' &mdash; including <strong>' + activeCount + '</strong> currently active.' +
        ' <a href="#" class="upgrade-link">Upgrade &rarr;</a>' +
        '</div>';
    }
  });

  setHTML(coinListEl, html);

  // Attach checkbox listeners after DOM injection
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

  setHTML(searchDropdown, matches
    .map(s => '<div class="search-item" data-coin="' + esc(s) + '">' + esc(s) + '</div>')
    .join(''));
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
// Parse a date string like "2026-03-19" as a local-time date (noon to avoid
// any DST edge at midnight).  Used for day/week bucket keys which represent
// calendar days and must not shift when displayed in local time.
// Tooltip date label for a single bar
// X-axis labels. posHint: 'first' or 'last' to pick start/end of week range.
// ── HTML escape ───────────────────────────────────────────────────────
// Compact count: 1.2M / 45.3K / 812
function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setHTML(el, html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  el.replaceChildren();
  while (doc.body.firstChild) el.appendChild(document.adoptNode(doc.body.firstChild));
}
