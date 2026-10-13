/* PFIC Wholesale Validation – review logic (browser + Node). Pure functions, no network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFIC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AMAZON_UK_SELLER = 'A3P5ROKL5A1OLE';
  const KEEPA_EPOCH_MIN = 21564000;
  const msToK = (ms) => Math.floor(ms / 60000) - KEEPA_EPOCH_MIN;
  const D14 = 14 * 1440, D30 = 30 * 1440, D60 = 60 * 1440, D76 = 76 * 1440, D90 = 90 * 1440;

  // PFIC screening guidelines from the checklist. Items marked (tool default) are NOT in the checklist.
  const DEFAULTS = {
    vat: 'unknown',            // yes | no | unknown
    vatRate: 0.2,
    minUnits: 30, goodUnits: 100,
    maxPriceDrop: 0.15,
    compMin: 2, compMax: 10,
    bbThirdPartyMin: 20,       // (tool default) % of 90d Buy Box won by non-Amazon sellers
    amazonDominantMax: 80,     // (tool default) Amazon share at/above this = FAIL W07
    amazonRejectAt: 95,        // (tool default)
    allowancePct: 2,           // (tool default) % of price for returns/damage/storage
    minMargin: 15, minRoi: 30, minProfit: 3,
    sensitivity: 0.10,
    maxSellDays: 60,
    deep: false
  };

  // ---------- helpers ----------
  const num = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).replace(/[£,\s]/g, '').replace('%', '');
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  };
  const gbp = (n) => (n < 0 ? '-£' : '£') + Math.abs(n).toFixed(2);
  const pct = (n) => n.toFixed(1) + '%';
  const pairs = (a) => { const o = []; if (!Array.isArray(a)) return o; for (let i = 0; i + 1 < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };

  function winStats(a, fromK, toK) {
    const p = pairs(a); let dur = 0, sum = 0, min = Infinity;
    for (let i = 0; i < p.length; i++) {
      const s = Math.max(p[i][0], fromK);
      const e = Math.min(i + 1 < p.length ? p[i + 1][0] : toK, toK);
      if (e > s && p[i][1] >= 0) { const v = p[i][1] / 100, d = e - s; dur += d; sum += v * d; if (v < min) min = v; }
    }
    return dur > 0 ? { avg: sum / dur, min, cov: dur / (toK - fromK) } : null;
  }
  function dropBuckets(rank, nowK) {
    const p = pairs(rank), b = [0, 0, 0];
    if (p.length < 6) return null;
    for (let i = 1; i < p.length; i++) {
      const age = nowK - p[i][0];
      if (age < 0 || age >= D90) continue;
      if (p[i][1] > 0 && p[i - 1][1] > 0 && p[i][1] < p[i - 1][1]) b[age < D30 ? 2 : age < D60 ? 1 : 0]++;
    }
    return b; // oldest -> newest 30-day buckets
  }
  function bbShares(hist, nowK) {
    const p = pairs(hist), from = nowK - D90, t = {}; let total = 0;
    for (let i = 0; i < p.length; i++) {
      const s = Math.max(p[i][0], from), e = Math.min(i + 1 < p.length ? p[i + 1][0] : nowK, nowK);
      const id = String(p[i][1]);
      if (e <= s || id === '-1' || id === '-2' || id === '') continue;
      t[id] = (t[id] || 0) + (e - s); total += e - s;
    }
    if (!total) return null;
    const sh = {}; Object.keys(t).forEach((k) => (sh[k] = (t[k] / total) * 100));
    return { sh, coverage: total / D90 };
  }

  // ---------- Keepa extraction ----------
  function extractKeepa(p, nowMs) {
    if (!p || !p.stats) return { ok: false };
    const nowK = msToK(nowMs), st = p.stats, csv = p.csv || [];
    const cur = st.current || [], a90 = st.avg90 || [];
    const k = { ok: true, title: p.title, brand: p.brand };
    const pr = (arr) => (arr[18] > 0 ? arr[18] / 100 : arr[1] > 0 ? arr[1] / 100 : null);
    k.priceNow = pr(cur); k.priceAvg90 = pr(a90);
    k.amazonOnListing = cur[0] > 0;
    k.newOffers = cur[11] >= 0 ? cur[11] : null;
    k.drops30 = st.salesRankDrops30 >= 0 ? st.salesRankDrops30 : null;
    k.drops90 = st.salesRankDrops90 >= 0 ? st.salesRankDrops90 : null;
    k.monthlyUnits = k.drops90 != null ? k.drops90 / 3 : null;
    const series = csv[18] && csv[18].length ? csv[18] : csv[1];
    const first = winStats(series, nowK - D90, nowK - D76), last = winStats(series, nowK - D14, nowK), all = winStats(series, nowK - D90, nowK);
    k.priceCov = all ? all.cov : 0;
    if (first && last && all && all.cov >= 0.5) {
      k.priceDrop = 1 - last.avg / first.avg; k.priceFirst = first.avg; k.priceLast = last.avg;
      k.deepDiscount = all.min < 0.8 * all.avg; k.priceMin = all.min;
    }
    k.buckets = dropBuckets(csv[3], nowK);
    let b = bbShares(p.buyBoxSellerIdHistory, nowK);
    if (!b && st.buyBoxStats) {
      const sh = {}; let tot = 0;
      Object.keys(st.buyBoxStats).forEach((id) => { const v = st.buyBoxStats[id].percentageWon; if (v >= 0) { sh[id] = v; tot += v; } });
      if (tot > 0) { Object.keys(sh).forEach((id) => (sh[id] = (sh[id] / tot) * 100)); b = { sh, coverage: null }; }
    }
    if (b) { k.amazonShare = b.sh[AMAZON_UK_SELLER] || 0; k.thirdShare = 100 - k.amazonShare; k.bbSellers = Object.keys(b.sh).filter((x) => x !== AMAZON_UK_SELLER).length; k.bbCov = b.coverage; }
    if (Array.isArray(p.offers)) {
      k.fbaSellers = p.offers.filter((o) => o.isFBA && !o.isAmazon && o.sellerId !== AMAZON_UK_SELLER && o.lastSeen >= nowK - 4320 && (o.condition == null || o.condition === 1)).length;
    }
    return k;
  }

  // ---------- economics ----------
  function economics(row, price, vatMode, S) {
    const landed = num(row.landed) != null ? num(row.landed) : (num(row.cost) != null ? num(row.cost) + (num(row.shipping) || 0) : null);
    const refRaw = row.referral, fbaFee = num(row.fba);
    if (price == null || landed == null || refRaw == null || refRaw === '' || fbaFee == null) return null;
    let r = num(refRaw), referral;
    if (r == null) return null;
    referral = /%/.test(String(refRaw)) ? price * (r / 100) : r <= 0.5 ? price * r : r;
    const proceeds = vatMode === 'yes' ? price / (1 + S.vatRate) : price;
    const allowance = price * (S.allowancePct / 100);
    const profit = proceeds - landed - referral - fbaFee - allowance;
    return { price, proceeds, landed, referral, fbaFee, allowance, profit, margin: (profit / proceeds) * 100, roi: (profit / landed) * 100, refIsPct: /%/.test(String(refRaw)) || r <= 0.5, refRate: /%/.test(String(refRaw)) ? r / 100 : r <= 0.5 ? r : null };
  }

  // ---------- review ----------
  function reviewProduct(row, keepa, userSettings, dateStr) {
    const S = Object.assign({}, DEFAULTS, userSettings || {});
    const k = keepa && keepa.ok ? keepa : { ok: false };
    const C = {}; // checks
    const set = (id, status, points, max, detail) => (C[id] = { id, status, points: status === 'PASS' ? points : 0, max, detail });
    const src = 'Keepa UK ' + dateStr;

    // W02 demand
    if (k.monthlyUnits == null) set('W02', 'UNVERIFIED', 0, 1, 'no Keepa sales-rank-drop data');
    else if (k.monthlyUnits >= S.minUnits) set('W02', 'PASS', 1, 1, '~' + Math.round(k.monthlyUnits) + ' units/mo whole listing (' + src + ')' + (k.monthlyUnits >= S.goodUnits ? ', 100+ met' : ', 30+ met'));
    else set('W02', 'FAIL', 0, 1, '~' + Math.round(k.monthlyUnits) + ' units/mo whole listing, below the 30 minimum');

    // W03 consistency
    if (!k.buckets) set('W03', 'UNVERIFIED', 0, 1, 'no usable 90-day rank history');
    else {
      const [a, b, c] = k.buckets, mean = (a + b + c) / 3, mx = Math.max(a, b, c), mn = Math.min(a, b, c);
      const desc = 'rank drops per 30 days: ' + a + ' / ' + b + ' / ' + c;
      if (mean >= S.minUnits && mn >= 0.5 * mean && mx <= 2 * mean) set('W03', 'PASS', 1, 1, desc + ', steady');
      else set('W03', mean < S.minUnits ? 'FAIL' : 'REVIEW', 0, 1, desc + (mean < S.minUnits ? ', below 30/mo' : ', uneven – check spikes/stockouts/seasonality'));
    }

    // W04 price stability
    if (k.priceDrop == null) set('W04', 'UNVERIFIED', 0, 1, 'not enough 90-day price history');
    else if (k.priceDrop < S.maxPriceDrop) set('W04', 'PASS', 1, 1, 'price ' + (k.priceDrop > 0 ? '-' : '+') + pct(Math.abs(k.priceDrop) * 100) + ' over 90d' + (k.deepDiscount ? '; deep dips seen' : ''));
    else set('W04', 'FAIL', 0, 1, 'price fell ' + pct(k.priceDrop * 100) + ' over 90d (' + gbp(k.priceFirst) + ' to ' + gbp(k.priceLast) + '), limit 15%');

    // W05 competition
    if (k.fbaSellers == null) set('W05', 'UNVERIFIED', 0, 1, 'FBA seller count needs "deep seller data" Keepa run or offer-page screenshot' + (k.newOffers != null ? ' (Keepa shows ' + k.newOffers + ' new offers, not FBA-only)' : ''));
    else if (k.fbaSellers >= S.compMin && k.fbaSellers <= S.compMax) set('W05', 'PASS', 1, 1, k.fbaSellers + ' FBA third-party seller(s) live');
    else set('W05', 'REVIEW', 0, 1, k.fbaSellers + ' FBA third-party seller(s), outside 2–10');

    // W06 / W07 Buy Box
    if (k.thirdShare == null) { set('W06', 'UNVERIFIED', 0, 2, 'no Buy Box seller history'); set('W07', 'UNVERIFIED', 0, 1, 'no Buy Box seller history'); }
    else {
      if (k.thirdShare >= S.bbThirdPartyMin) set('W06', 'PASS', 2, 2, 'third-party sellers held ' + pct(k.thirdShare) + ' of 90d Buy Box (' + k.bbSellers + ' sellers)');
      else set('W06', 'FAIL', 0, 2, 'third-party sellers held only ' + pct(k.thirdShare) + ' of 90d Buy Box');
      if (k.amazonShare < S.amazonDominantMax) set('W07', 'PASS', 1, 1, 'Amazon held ' + pct(k.amazonShare) + ' of 90d Buy Box');
      else set('W07', 'FAIL', 0, 1, 'Amazon held ' + pct(k.amazonShare) + ' of 90d Buy Box');
    }

    // Economics
    const vatMode = S.vat;
    const priceVerified = k.priceAvg90 != null || k.priceNow != null;
    const price = priceVerified ? Math.min(...[k.priceAvg90, k.priceNow].filter((x) => x != null)) : num(row.price);
    const eco = economics(row, price, vatMode === 'unknown' ? 'yes' : vatMode, S);
    const ecoMissing = [];
    if (!priceVerified) ecoMissing.push('verified selling price');
    if (num(row.landed) == null && num(row.cost) == null) ecoMissing.push('landed unit cost');
    if (num(row.fba) == null || row.referral == null || row.referral === '') ecoMissing.push('referral + FBA fees');
    if (vatMode === 'unknown') ecoMissing.push('VAT status');
    let ecoOk = eco && ecoMissing.length === 0;
    if (!ecoOk) set('W18-20', 'UNVERIFIED', 0, 2, 'missing: ' + (ecoMissing.join(', ') || 'inputs'));
    else {
      const p1 = eco.margin >= S.minMargin, p2 = eco.roi >= S.minRoi, p3 = eco.profit >= S.minProfit, n = [p1, p2, p3].filter(Boolean).length;
      const d = 'profit ' + gbp(eco.profit) + '/unit, margin ' + pct(eco.margin) + ', ROI ' + pct(eco.roi);
      if (eco.profit <= 0) set('W18-20', 'FAIL', 0, 2, d + ' – negative/zero');
      else set('W18-20', n === 3 ? 'PASS' : 'FAIL', n === 3 ? 2 : 0, 2, d + (n === 3 ? '' : ' (below ' + [!p1 && '15% margin', !p2 && '30% ROI', !p3 && '£3 profit'].filter(Boolean).join(', ') + ')'));
      if (n === 2) { C['W18-20'].points = 1; C['W18-20'].status = 'FAIL'; }
    }
    // indicative figures when unverified but computable
    const indicative = !ecoOk && eco ? eco : null;

    // W21 sensitivity (not scored)
    let sens = null;
    if (eco) {
      const p2 = eco.price * (1 - S.sensitivity);
      const e2 = economics(Object.assign({}, row, { referral: eco.refIsPct ? (eco.refRate * 100) + '%' : row.referral }), p2, vatMode === 'unknown' ? 'yes' : vatMode, S);
      if (e2) sens = e2.profit;
    }

    // W22 sell-through
    const moq = num(row.moq);
    if (moq == null || k.monthlyUnits == null || k.fbaSellers == null) {
      const miss = [moq == null && 'MOQ', k.monthlyUnits == null && 'demand', k.fbaSellers == null && 'FBA seller count'].filter(Boolean);
      set('W22', 'UNVERIFIED', 0, 1, 'missing: ' + miss.join(', '));
    } else {
      const share = 1 / (k.fbaSellers + 1) * (k.amazonShare != null ? (100 - k.amazonShare) / 100 : 1);
      const perMonth = k.monthlyUnits * share, days = perMonth > 0 ? (moq / perMonth) * 30 : Infinity;
      const dTxt = days > 365 ? '365+' : String(Math.round(days));
      if (days <= S.maxSellDays) set('W22', 'PASS', 1, 1, 'MOQ ' + moq + ' ≈ ' + dTxt + ' days at est. ' + perMonth.toFixed(1) + ' units/mo for you');
      else set('W22', 'REVIEW', 0, 1, 'MOQ ' + moq + ' ≈ ' + dTxt + ' days at est. ' + perMonth.toFixed(1) + ' units/mo, over 60');
    }

    // score
    const list = Object.values(C);
    const earned = list.reduce((s, c) => s + c.points, 0);
    const verifiedMax = list.filter((c) => c.status !== 'UNVERIFIED').reduce((s, c) => s + c.max, 0);
    const unverPts = list.filter((c) => c.status === 'UNVERIFIED').reduce((s, c) => s + c.max, 0);
    const potential = earned + unverPts;

    // verdict
    let verdict, why;
    const negEco = C['W18-20'].status === 'FAIL' && eco && eco.profit <= 0 && ecoOk;
    const noBB = C.W06.status === 'FAIL' && k.amazonShare != null && k.amazonShare >= S.amazonRejectAt;
    if (negEco || noBB) { verdict = 'REJECT'; why = negEco ? 'negative unit economics' : 'Amazon holds ~all Buy Box, no third-party opportunity'; }
    else if (potential < 6) { verdict = 'HOLD'; why = 'cannot reach 6/10 even if open checks pass'; }
    else if (earned >= 8 && unverPts === 0) { verdict = 'PROMISING'; why = 'move to supplier validation'; }
    else if (earned >= 6 && unverPts === 0) { verdict = 'MAYBE'; why = 'targeted research required'; }
    else { verdict = 'MAYBE'; why = 'evidence still missing – provisional'; }

    // student-reported (not verified) gate info
    const stud = [];
    if (row.elig) stud.push('student says eligibility: "' + String(row.elig).slice(0, 30) + '" (unverified)');
    const hasSupplier = !!(row.supplier && String(row.supplier).trim());
    const stage = hasSupplier && num(row.cost) != null ? 'SUPPLIER VALIDATION' : 'INITIAL SCREEN';

    const res = { checks: C, earned, verifiedMax, unverPts, potential, verdict, why, stage, eco, indicative, sens, price, k, S, dateStr };
    res.note = buildNote(res, row);
    return res;
  }

  // ---------- coach note ----------
  function buildNote(r, row) {
    const C = r.checks, S = r.S, k = r.k;
    const pos = [], bad = [], miss = [], acts = [];
    Object.values(C).forEach((c) => {
      const code = c.id.replace('W18-20', 'W18–20');
      if (c.status === 'PASS' && pos.length < 2) pos.push(code + ': ' + c.detail);
      if (c.status === 'FAIL' || c.status === 'REVIEW') bad.push(code + ' ' + (c.status === 'REVIEW' ? '(explain)' : 'FAIL') + ': ' + c.detail);
    });
    if (r.sens != null) { if (r.sens <= 0) bad.push('W21 FAIL: profit goes to ' + gbp(r.sens) + ' if price drops 10%'); else if (Object.keys(C).length) pos.length < 2 && pos.push('W21: still ' + gbp(r.sens) + '/unit at -10% price'); }
    ['W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W18-20', 'W22'].forEach((id) => { if (C[id].status === 'UNVERIFIED') miss.push(id.replace('W18-20', 'W18–20') + ' (' + C[id].detail + ')'); });
    if (r.indicative) bad.push('indicative only (VAT/inputs unconfirmed): ' + gbp(r.indicative.profit) + '/unit');
    miss.push('W01, W08–W14 (pack match, listing health, eligibility, brand/IP, supplier + invoice, compliance, MOQ terms) – no verified evidence');

    // actions
    const fails = Object.values(C).filter((c) => c.status === 'FAIL').map((c) => c.id);
    if (fails.includes('W06') || fails.includes('W07')) acts.push('Explain why you expect Buy Box share given who holds it, or pick another product');
    if (fails.includes('W02') || fails.includes('W03')) acts.push('Show stronger/steadier demand (90 + 365-day Keepa charts) or choose a different product');
    if (fails.includes('W04')) acts.push('Explain the price drop and check recurring discounting');
    if (fails.includes('W18-20')) acts.push('Renegotiate cost, check fees/VAT, or drop it');
    ['W02', 'W03', 'W04', 'W06', 'W07'].some((id) => C[id].status === 'UNVERIFIED') && acts.push('Upload 90-day Keepa price + Buy Box seller charts for this ASIN');
    C['W05'].status === 'UNVERIFIED' && acts.push('Add FBA seller count (offer page screenshot)');
    C['W18-20'].status === 'UNVERIFIED' && acts.push('Fill landed cost, referral + FBA fees from the Revenue Calculator and VAT status');
    acts.push('Get supplier quote + sample invoice and Add a Product eligibility screenshot');
    const A = acts.slice(0, 3).map((a, i) => (i + 1) + ') ' + a).join('; ');

    const scoreTxt = r.earned + '/' + r.verifiedMax + ' verified' + (r.unverPts ? ', ' + r.unverPts + ' pts unverified' : '') + ' (of 10)';
    const lines = [
      '[PFIC review ' + r.dateStr + ']',
      'Review stage: ' + r.stage + '. Verdict: ' + r.verdict + ' – ' + r.why + '. Score ' + scoreTxt + '.',
      'Positive evidence: ' + (pos.join('; ') || 'none verified'),
      'Key concerns / failed checks: ' + (bad.slice(0, 4).join('; ') || 'none found in checked items'),
      'Missing evidence: ' + miss.join('; '),
      'Next actions: ' + A + '. Coach reviews these next.',
      'Purchase status: NOT APPROVED TO BUY until final coach sign-off.'
    ];
    return lines.join('\n');
  }

  const words = (s) => String(s).split(/\s+/).filter(Boolean).length;
  return { DEFAULTS, AMAZON_UK_SELLER, extractKeepa, reviewProduct, economics, num, words, msToK };
});
