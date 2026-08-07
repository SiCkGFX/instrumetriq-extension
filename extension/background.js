'use strict';

importScripts('secrets.js');
importScripts('extensionpay.js');

const PAYLOAD_URL        = 'https://api.instrumetriq.com/data/extension_payload_v2.json';
const PAYLOAD_SCHEMA     = 2;   // reject anything else rather than render it wrongly
const ALARM_NAME         = 'instrumetriq-poll';
const POLL_INTERVAL      = 5; // periodInMinutes
const PRO_CACHE_TTL_MS   = 3_600_000; // 1 hour

// IMPORTANT: replace 'EXTENSIONPAY_ID' with your extension ID from the
// ExtensionPay dashboard (https://extensionpay.com) before publishing.
const EXTENSIONPAY_ID    = 'instrumetriq';
const extpay             = ExtPay(EXTENSIONPAY_ID);
extpay.startBackground(); // required: sets up ExtPay's internal message listener

// Immediately update isPro when a payment completes.
extpay.onPaid.addListener(() => {
  chrome.storage.local.set({ isPro: true, proCachedAt: Date.now() });
});

// ── On first install / update: migrate storage, then start polling ────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') await migrateToV2();
  ensureAlarm();
  fetchPayload();
  checkProLicense();
});

// ── Storage migration, v1 -> v2 ───────────────────────────────────────
// An upgrading user's chrome.storage.local holds v1-shaped state. The popup
// renders from `lastPayload` on open, BEFORE the first poll returns, so without
// this the first open after updating runs v2 code against a v1 payload.
//
// Clear only what is keyed to retired semantics. NEVER touch trackedCoins or
// isPro: losing a Pro user's entitlement or their coin list on upgrade is the
// worst outcome available here, and it is not recoverable client-side.
async function migrateToV2() {
  try {
    const { lastPayload } = await chrome.storage.local.get('lastPayload');
    if (lastPayload && lastPayload.schema_version === PAYLOAD_SCHEMA) return; // already v2

    await chrome.storage.local.remove([
      'lastPayload',        // v1 schema - popup would misread it
      'lastPushedAt',       // paired with lastPayload; stale value suppresses alerts
      'notifiedHot',        // keyed to the retired Buzzing/Spiking levels
      'narrativeTexts',     // AI narrative retired in v2
      'narrativePushedAt'
    ]);
    // trackedCoins, isPro, proCachedAt, badgeMode, notificationsEnabled: PRESERVED.
  } catch (_e) {
    // A failed migration must not brick startup - the schema guard in
    // fetchPayload() still prevents a v1 payload from being rendered.
  }
}

// ── On browser startup: re-create alarm if Chrome cleared it ─────────
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  checkProLicense();
});

// ── Alarm fired: poll for new payload ────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) fetchPayload();
});

// ── Message from popup ───────────────────────────────────────────────
let _lastManualFetch = 0;
const MANUAL_COOLDOWN_MS = 10_000;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_NOW') {
    const now = Date.now();
    if (now - _lastManualFetch < MANUAL_COOLDOWN_MS) {
      sendResponse({ ok: false, reason: 'cooldown' });
      return false;
    }
    _lastManualFetch = now;
    // Repair a missing alarm while we are here. It is otherwise only created on
    // install and browser startup, so if it is ever lost mid-session the poll
    // stops until the browser restarts and the cache ages unbounded. Opening the
    // popup is a good moment to check.
    ensureAlarm();
    fetchPayload().then(() => sendResponse({ ok: true }));
    return true; // keep channel open for async response
  }

  if (msg.type === 'UPGRADE_CLICK') {
    extpay.openPaymentPage();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'RESTORE_LICENSE') {
    extpay.openLoginPage();
    sendResponse({ ok: true });
    return false;
  }
});

// ── Pro license check (1h TTL cache) ─────────────────────────────────
async function checkProLicense() {
  try {
    const { proCachedAt } = await chrome.storage.local.get('proCachedAt');
    if (proCachedAt && (Date.now() - proCachedAt < PRO_CACHE_TTL_MS)) return;
    const user = await extpay.getUser();
    await chrome.storage.local.set({ isPro: user.paid, proCachedAt: Date.now() });
  } catch (_e) {
    // Network error - keep existing cached value
  }
}

// ── Ensure the polling alarm exists ──────────────────────────────────
async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL });
  }
}

// ── Fetch payload from API, update storage, badge, notifications ──────
async function fetchPayload() {
  try {
    const { lastPayload } = await chrome.storage.local.get('lastPayload');

    const headers = { 'Authorization': 'Bearer ' + BEARER_TOKEN };
    if (lastPayload?.pushed_at) {
      headers['If-Modified-Since'] = new Date(lastPayload.pushed_at).toUTCString();
    }

    const res = await fetch(PAYLOAD_URL, { headers });
    if (res.status === 304) return; // not modified
    if (!res.ok) return;

    const payload = await res.json();

    // Refuse a payload we do not understand. Rendering a v1-shaped payload with v2
    // code produces silently wrong output rather than an error, so this fails
    // closed: keep whatever is already cached and try again next alarm.
    if (payload?.schema_version !== PAYLOAD_SCHEMA) return;

    // Batched read of all keys needed for badge and notification decisions
    const { trackedCoins, badgeMode, notificationsEnabled, lastPushedAt, isPro }
      = await chrome.storage.local.get([
          'trackedCoins', 'badgeMode', 'notificationsEnabled', 'lastPushedAt', 'isPro'
        ]);

    const coins  = trackedCoins         ?? [];
    const mode   = badgeMode            ?? 'my_coins';
    const notifs = notificationsEnabled ?? false;

    // New-install suppression: first-ever payload sets the baseline and
    // does NOT fire any notification (the data may already be stale).
    if (!lastPushedAt) {
      await chrome.storage.local.set({
        lastPayload:  payload,
        lastPushedAt: payload.pushed_at
      });
      updateBadge(payload, coins, mode);
      return;
    }

    // Determine whether this is a genuinely new push
    const isNew = payload.pushed_at > lastPushedAt;

    // Write new payload. Advance lastPushedAt when a new cycle is detected so
    // subsequent polls for the same cycle don't re-fire notifications.
    await chrome.storage.local.set({
      lastPayload: payload,
      ...(isNew ? { lastPushedAt: payload.pushed_at } : {})
    });

    updateBadge(payload, coins, mode);

    if (isNew && notifs) {
      maybeNotify(payload, coins);
    }

  } catch (_e) {
    // Silent failure - badge and popup retain their last known state
  }
}

// ── Badge color update ────────────────────────────────────────────────
function updateBadge(payload, trackedCoins, badgeMode) {
  // Amber: feed has gone quiet (payload_builder wrote feed_ok: false)
  if (!payload.feed_ok) {
    chrome.action.setBadgeBackgroundColor({ color: '#FFB74D' });
    chrome.action.setBadgeText({ text: ' ' });
    return;
  }

  let active = false;

  if (badgeMode === 'all_coins') {
    // Cyan whenever anything in the universe is spiking
    active = (payload.universe?.spiking ?? 0) > 0;
  } else {
    // my_coins (default): only reflect the user's tracked coins
    const coinMap = {};
    (payload.coins ?? []).forEach(c => { coinMap[c.symbol] = c; });
    active = trackedCoins.some(sym => isSpiking(coinMap[sym]));
  }

  if (active) {
    chrome.action.setBadgeBackgroundColor({ color: '#00BCD4' });
    chrome.action.setBadgeText({ text: ' ' });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#909090' });
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Is this coin currently at an attention spike? ─────────────────────
// v2 replaces the four-level chatter label with the published attention
// definition: distinct authors >= 6x the median of up to 20 prior cycles.
// It fires on ~1% of coin-cycles versus the old Buzzing+Spiking rate, so
// ALERT VOLUME DROPS. That is intended - rarer alerts that mean something.
function isSpiking(coin) {
  return coin?.attention?.state === 'spike';
}

// ── Aggregated desktop notification: one alert per coin per hot-spell ──
// Only announces coins that JUST started spiking (weren't spiking last cycle).
// A coin that stays hot across cycles is announced once rather than every cycle,
// important at ~40min cycles. `notifiedHot` holds the currently-hot tracked
// symbols; a coin can alert again after it cools.
async function maybeNotify(payload, trackedCoins) {
  const coinMap = {};
  (payload.coins ?? []).forEach(c => { coinMap[c.symbol] = c; });

  const active = trackedCoins.filter(sym => isSpiking(coinMap[sym]));

  const { notifiedHot } = await chrome.storage.local.get('notifiedHot');
  const prevHot = new Set(notifiedHot ?? []);

  // Newly hot this cycle = currently hot AND not already announced.
  const newly = active.filter(sym => !prevHot.has(sym));

  // Persist the current hot set: still-hot coins won't re-fire; coins that
  // cooled drop out and may alert again next time they heat up.
  await chrome.storage.local.set({ notifiedHot: active });

  if (!newly.length) return;

  // `notifications` is optional in v2 and may have been revoked in browser
  // settings after being granted. Check before firing rather than throwing.
  if (chrome.permissions) {
    const has = await chrome.permissions.contains({ permissions: ['notifications'] });
    if (!has) return;
  }

  const msg = newly.length === 1
    ? newly[0] + ' is getting unusual posting attention.'
    : newly.slice(0, -1).join(', ') + ' and ' + newly[newly.length - 1] +
      ' are getting unusual posting attention.';

  chrome.notifications.create('instrumetriq-alert', {
    type:    'basic',
    iconUrl: 'icons/icon48.png',
    title:   'Instrumetriq',
    message: msg
  });
}
