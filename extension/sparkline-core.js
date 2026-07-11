// ── sparkline-core.js ──────────────────────────────────────────────────────
// CANONICAL sparkline logic shared by the extension (popup.js) and the pulse
// website (pulse/index.astro). This file lives in the PUBLIC instrumetriq-
// extension repo and is vendored (read-only copy) into the private site — edit
// it HERE, never in the copy. Pure logic only: no DOM, no CSS, no network, no
// entitlement/paywall code. Each surface keeps its own HTML/CSS "paint".
//
// Exposes a global `SparklineCore` (classic script, no bundler needed).
//
// The two surfaces differ only by config passed in `opts`:
//   extension: windowDays 7   |   pulse: windowDays 30
// cycleMinutes comes from the payload's `cycle_minutes_approx`; when < 90 the
// cycle view merges raw bars into ~2h logical bars but keeps the NEWEST raw bar
// standalone (the "live head") so it always reflects the latest sweep and its
// color matches the Chatter-tone text.

var SparklineCore = (function () {
  var MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var BUCKET_MINUTES = 120;   // ~2h target for merged cycle bars

  function fmtDate(d)     { return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate(); }
  function fmtClock(d)    { return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
  function fmtDateTime(d) { return fmtDate(d) + ', ' + fmtClock(d); }
  function localDate(ymd) { return new Date(ymd + 'T12:00:00'); }  // noon: avoid DST midnight edge

  // net-tone score -> semantic token (each surface maps token -> its own CSS class)
  function toneClass(v) {
    if (v == null) return 'mixed';
    return v > 8 ? 'positive' : v < -8 ? 'negative' : 'mixed';
  }

  // Aggregate raw sparkline arrays for one coin.
  //   opts: { posArr, negArr, cycleMinutes, windowDays=7, bucketMinutes=120 }
  //   returns { vals, tones, stamps, keys, pos, neg, firstTs, lastTs }
  // keys[i] encodes the bar's time span for the tooltip:
  //   cycle merged  -> "tsStart|tsEnd"      cycle live-head -> "ts|LATEST"
  //   cycle raw     -> ""                    day -> "YYYY-MM-DD"   week -> "startYMD|endYMD"
  function aggregateSparkline(sl, tone, ts, mode, opts) {
    opts = opts || {};
    var posArr = opts.posArr || null, negArr = opts.negArr || null;
    var windowDays  = opts.windowDays  || 7;
    var bucketMin   = opts.bucketMinutes || BUCKET_MINUTES;
    var cycleMinutes = opts.cycleMinutes;
    sl = sl || [];

    if (mode === 'cycle') {
      // Rolling windowDays window (by timestamp).
      var start = 0;
      if (ts && ts.length) {
        var cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();
        for (var i = 0; i < ts.length; i++) { if (ts[i] >= cutoff) { start = i; break; } }
      } else {
        start = Math.max(0, sl.length - 60);
      }
      var wVals   = sl.slice(start).map(function (v) { return (v != null && v > 0) ? v : 0; });
      var wTones  = tone   ? tone.slice(start)   : null;
      var wStamps = ts     ? ts.slice(start)     : null;
      var wPos    = posArr ? posArr.slice(start) : null;
      var wNeg    = negArr ? negArr.slice(start) : null;

      var mergeFactor = (typeof cycleMinutes === 'number' && cycleMinutes > 0 && cycleMinutes < 90)
        ? Math.max(2, Math.round(bucketMin / cycleMinutes)) : 1;

      if (mergeFactor < 2 || !wStamps || wVals.length <= 2) {
        return {
          vals: wVals, tones: wTones, stamps: wStamps, keys: null, pos: wPos, neg: wNeg,
          firstTs: wStamps ? wStamps[0] : '', lastTs: wStamps ? wStamps[wStamps.length - 1] : ''
        };
      }

      var mVals = [], mTones = [], mStamps = [], mKeys = [], mPos = [], mNeg = [];
      var pushGroup = function (a, b) { // merge windowed indices [a, b)
        var vs = 0, vc = 0, tsum = 0, tc = 0, psum = 0, nsum = 0, rc = 0;
        for (var k = a; k < b; k++) {
          if (wVals[k] != null && wVals[k] > 0) vs += wVals[k];
          vc++;
          if (wTones && wTones[k] != null) { tsum += wTones[k]; tc++; }
          if (wPos && wPos[k] != null && wNeg && wNeg[k] != null) { psum += wPos[k]; nsum += wNeg[k]; rc++; }
        }
        mVals.push(vc ? vs / vc : 0);
        mTones.push(tc ? Math.round(tsum / tc) : null);
        mStamps.push(wStamps[b - 1]);
        mKeys.push(wStamps[a] + '|' + wStamps[b - 1]);
        mPos.push(rc ? psum / rc : null);
        mNeg.push(rc ? nsum / rc : null);
      };
      var headIdx = wVals.length - 1;                    // newest raw bar = live head
      for (var g = 0; g < headIdx; g += mergeFactor) {
        pushGroup(g, Math.min(g + mergeFactor, headIdx));
      }
      mVals.push(wVals[headIdx]);
      mTones.push(wTones ? wTones[headIdx] : null);
      mStamps.push(wStamps[headIdx]);
      mKeys.push(wStamps[headIdx] + '|LATEST');
      mPos.push(wPos ? wPos[headIdx] : null);
      mNeg.push(wNeg ? wNeg[headIdx] : null);

      return {
        vals: mVals, tones: mTones, stamps: mStamps, keys: mKeys, pos: mPos, neg: mNeg,
        firstTs: mStamps[0], lastTs: mStamps[mStamps.length - 1]
      };
    }

    // ── Day / Week: bucket entries (identical across both surfaces) ──
    var buckets = {};
    var weekEdges = null;
    if (mode === 'week') {
      weekEdges = [];
      var today = new Date(); today.setUTCHours(23, 59, 59, 999);
      var cursor = new Date(today);
      while (weekEdges.length < 4) {
        var wEnd = new Date(cursor);
        var wStart = new Date(cursor); wStart.setUTCDate(wStart.getUTCDate() - 6); wStart.setUTCHours(0, 0, 0, 0);
        weekEdges.push({ start: wStart.getTime(), end: wEnd.getTime(), key: wStart.toISOString().slice(0, 10) + '|' + wEnd.toISOString().slice(0, 10) });
        cursor = new Date(wStart); cursor.setUTCDate(cursor.getUTCDate() - 1); cursor.setUTCHours(23, 59, 59, 999);
      }
      weekEdges.reverse();
    }
    var cutoff30d = new Date(); cutoff30d.setUTCDate(cutoff30d.getUTCDate() - 30); cutoff30d.setUTCHours(0, 0, 0, 0);
    var cutoff30dMs = cutoff30d.getTime();

    for (var j = 0; j < sl.length; j++) {
      if (!ts || !ts[j]) continue;
      var key;
      var dMs = new Date(ts[j]).getTime();
      if (mode === 'day') {
        if (dMs < cutoff30dMs) continue;
        key = ts[j].slice(0, 10);
      } else {
        key = null;
        for (var w = 0; w < weekEdges.length; w++) { if (dMs >= weekEdges[w].start && dMs <= weekEdges[w].end) { key = weekEdges[w].key; break; } }
        if (!key) continue;
      }
      if (!buckets[key]) buckets[key] = { sum: 0, count: 0, toneSum: 0, toneCount: 0, ts: ts[j], posSum: 0, negSum: 0, rc: 0 };
      var b = buckets[key];
      b.sum += (sl[j] != null && sl[j] > 0) ? sl[j] : 0;
      b.count++;
      if (tone && tone[j] != null) { b.toneSum += tone[j]; b.toneCount++; }
      b.ts = ts[j];
      if (posArr && posArr[j] != null && negArr && negArr[j] != null) { b.posSum += posArr[j]; b.negSum += negArr[j]; b.rc++; }
    }

    var keys = Object.keys(buckets).sort();
    if (keys.length === 0) return { vals: [], tones: [], stamps: [], keys: [], pos: [], neg: [], firstTs: '', lastTs: '' };
    return {
      vals:   keys.map(function (k) { return buckets[k].sum / buckets[k].count; }),
      tones:  keys.map(function (k) { return buckets[k].toneCount > 0 ? Math.round(buckets[k].toneSum / buckets[k].toneCount) : null; }),
      stamps: keys.map(function (k) { return buckets[k].ts; }),
      keys:   keys,
      pos:    keys.map(function (k) { return buckets[k].rc ? buckets[k].posSum / buckets[k].rc : null; }),
      neg:    keys.map(function (k) { return buckets[k].rc ? buckets[k].negSum / buckets[k].rc : null; }),
      firstTs: buckets[keys[0]].ts,
      lastTs:  buckets[keys[keys.length - 1]].ts
    };
  }

  // Tooltip date label for one bar. `bucketKey` per the encoding above.
  function formatBarDate(isoTs, mode, bucketKey) {
    try {
      if (mode === 'week' && bucketKey) {
        var wp = bucketKey.split('|');
        return fmtDate(localDate(wp[0])) + ' - ' + fmtDate(localDate(wp[1]));
      }
      if (mode === 'day' && bucketKey) {
        return fmtDate(localDate(bucketKey));
      }
      if (mode === 'cycle' && bucketKey) {
        var cp = bucketKey.split('|');
        if (cp.length < 2 || cp[0] === cp[1]) return fmtDateTime(new Date(cp[0]));
        if (cp[1] === 'LATEST') return fmtDateTime(new Date(cp[0])) + ' · latest';
        return fmtDateTime(new Date(cp[0])) + ' – ' + fmtClock(new Date(cp[1]));
      }
      if (!isoTs) return '';
      return fmtDateTime(new Date(isoTs));
    } catch (_e) { return ''; }
  }

  // X-axis end labels. hint: 'first' | 'last'.
  function formatAxisDate(isoTs, mode, bucketKey, hint) {
    try {
      if (mode === 'week' && bucketKey) {
        return fmtDate(localDate(bucketKey.split('|')[hint === 'last' ? 1 : 0]));
      }
      if (mode === 'day' && bucketKey) return fmtDate(localDate(bucketKey));
      if (mode === 'cycle' && hint === 'last') return 'Now';
      if (!isoTs) return '';
      return fmtDate(new Date(isoTs));
    } catch (_e) { return ''; }
  }

  return {
    aggregateSparkline: aggregateSparkline,
    toneClass: toneClass,
    formatBarDate: formatBarDate,
    formatAxisDate: formatAxisDate
  };
})();

// Node/CommonJS export for tests (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) module.exports = SparklineCore;
