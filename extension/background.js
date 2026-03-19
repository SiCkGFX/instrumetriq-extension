'use strict';

importScripts('secrets.js');
importScripts('extensionpay.js');

const PAYLOAD_URL        = 'https://api.instrumetriq.com/data/extension_payload.json';
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

// ── On first install: create alarm, fetch payload, check pro status ───
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  fetchPayload();
  checkProLicense();
});

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

    // Write new payload (lastPushedAt is intentionally never overwritten)
    await chrome.storage.local.set({ lastPayload: payload });

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
    // Cyan whenever anything in the universe is Buzzing or Spiking
    active = (payload.active_coin_count ?? 0) > 0;
  } else {
    // my_coins (default): only reflect the user's tracked coins
    const coinMap = {};
    (payload.coins ?? []).forEach(c => { coinMap[c.symbol] = c; });
    active = trackedCoins.some(sym => {
      const c = coinMap[sym];
      return c?.chatter?.ok &&
        (c.chatter.level === 'Buzzing' || c.chatter.level === 'Spiking');
    });
  }

  if (active) {
    chrome.action.setBadgeBackgroundColor({ color: '#00BCD4' });
    chrome.action.setBadgeText({ text: ' ' });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#909090' });
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Aggregated desktop notification (one per cycle) ───────────────────
function maybeNotify(payload, trackedCoins) {
  const coinMap = {};
  (payload.coins ?? []).forEach(c => { coinMap[c.symbol] = c; });

  const active = trackedCoins.filter(sym => {
    const c = coinMap[sym];
    return c?.chatter?.ok &&
      (c.chatter.level === 'Buzzing' || c.chatter.level === 'Spiking');
  });

  if (!active.length) return;

  const msg = active.length === 1
    ? active[0] + ' is getting unusual chatter right now.'
    : active.slice(0, -1).join(', ') + ' and ' + active[active.length - 1] +
      ' are getting unusual chatter right now.';

  chrome.notifications.create('instrumetriq-alert', {
    type:    'basic',
    iconUrl: 'icons/icon48.png',
    title:   'Instrumetriq',
    message: msg
  });
}
