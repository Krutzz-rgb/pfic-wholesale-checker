(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let wb = null, fileName = '', tables = [], results = [];

  try { $('pw').value = localStorage.getItem('pfic_pw') || ''; } catch (e) {}
  const log = (t) => ($('log').textContent = t);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  $('file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; $('run').disabled = true; $('results').hidden = true;
    if (!f) return;
    try {
      fileName = f.name; wb = new ExcelJS.Workbook(); await wb.xlsx.load(await f.arrayBuffer());
      tables = PFICSheet.findTables(wb);
      if (!tables.length) { log('No sheet with an ASIN column found. Check the header row.'); return; }
      const n = tables.reduce((s, t) => s + t.rows.length, 0);
      const noNotes = tables.filter((t) => !t.hasNotes).map((t) => t.sheetName);
      log(n + ' product row(s) found on ' + tables.length + ' sheet(s).' + (noNotes.length ? '\n⚠ No "Coach Notes" column on: ' + noNotes.join(', ') + ' – those sheets will not be edited (notes shown here only).' : ''));
      $('run').disabled = n === 0;
    } catch (err) { log('Could not read that file: ' + err.message); }
  });

  function settings() {
    const v = (id) => parseFloat($('t_' + id).value);
    return { vat: $('vat').value, deep: $('deep').checked, minUnits: v('minUnits'), maxPriceDrop: v('maxPriceDrop') / 100, bbThirdPartyMin: v('bbThirdPartyMin'), amazonDominantMax: v('amazonDominantMax'), allowancePct: v('allowancePct'), minMargin: v('minMargin'), minRoi: v('minRoi'), minProfit: v('minProfit') };
  }

  async function fetchKeepa(asins, S) {
    const out = {};
    for (let i = 0; i < asins.length; i += 5) {
      const batch = asins.slice(i, i + 5);
      for (let attempt = 0; attempt < 6; attempt++) {
        log('Keepa: ' + Math.min(i + 5, asins.length) + '/' + asins.length + ' ASINs' + (attempt ? ' (waiting for Keepa tokens…)' : ''));
        const res = await fetch('/.netlify/functions/keepa', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-password': $('pw').value }, body: JSON.stringify({ asins: batch, deep: S.deep }) });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) throw new Error('Wrong team password.');
        if (res.status === 429) { await sleep(Math.min((data.refillIn || 30000) + 1000, 120000)); continue; }
        if (!res.ok) throw new Error(data.error || (data.error && data.error.message) || 'Keepa error ' + res.status);
        (data.products || []).forEach((p) => (out[p.asin] = p));
        break;
      }
    }
    return out;
  }

  $('run').addEventListener('click', async () => {
    $('run').disabled = true; results = [];
    try { localStorage.setItem('pfic_pw', $('pw').value); } catch (e) {}
    const S = settings(), now = new Date(), dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    try {
      let kp = {};
      if (!$('skip').checked) {
        const asins = [...new Set(tables.flatMap((t) => t.rows.map((r) => r.data.asin)))];
        kp = await fetchKeepa(asins, S);
      }
      const notes = {};
      tables.forEach((t) => t.rows.forEach((r) => {
        const keepa = kp[r.data.asin] ? PFIC.extractKeepa(kp[r.data.asin], now.getTime()) : { ok: false };
        const rv = PFIC.reviewProduct(r.data, keepa, S, dateStr);
        notes[t.sheetName + '!' + r.rowNum] = rv.note;
        results.push({ sheet: t.sheetName, row: r.rowNum, asin: r.data.asin, name: r.data.name || (keepa.title || ''), edited: t.hasNotes, rv, keepaFound: !!kp[r.data.asin] });
      }));
      PFICSheet.writeNotes(tables, notes);
      render();
      log('Done. ' + results.length + ' product(s) reviewed.');
    } catch (err) { log('⚠ ' + err.message); }
    $('run').disabled = false;
  });

  function render() {
    const c = { PROMISING: 0, MAYBE: 0, HOLD: 0, REJECT: 0 };
    results.forEach((r) => c[r.rv.verdict]++);
    $('stats').innerHTML = '<div class="stat"><b>' + results.length + '</b>reviewed</div>' + Object.keys(c).map((k) => '<div class="stat"><b>' + c[k] + '</b>' + k.toLowerCase() + '</div>').join('');
    $('rows').innerHTML = results.map((r, i) =>
      '<tr><td>' + esc(r.sheet) + ' · ' + r.row + '</td><td><b>' + esc(r.asin) + '</b><br>' + esc(String(r.name).slice(0, 60)) + (r.keepaFound || $('skip').checked ? '' : '<br><span class="warn">Keepa returned nothing for this ASIN</span>') + (r.edited ? '' : '<br><span class="warn">No Coach Notes column – not written to file</span>') + '</td>' +
      '<td><span class="chip ' + r.rv.verdict + '">' + r.rv.verdict + '</span></td><td>' + r.rv.earned + '/' + r.rv.verifiedMax + '<br><span class="small">of 10 · ' + r.rv.unverPts + ' unverified</span></td>' +
      '<td><details><summary>View</summary><pre class="note">' + esc(r.rv.note) + '</pre></details></td></tr>').join('');
    $('results').hidden = false;
  }

  function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  $('dl').addEventListener('click', async () => {
    const buf = await wb.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName.replace(/\.xlsx$/i, '') + ' - PFIC REVIEWED ' + stamp + '.xlsx');
  });
  $('dlcsv').addEventListener('click', () => {
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const lines = [['Sheet', 'Row', 'ASIN', 'Product', 'Verdict', 'Earned', 'Verified max', 'Unverified pts', 'Note'].map(q).join(',')];
    results.forEach((r) => lines.push([r.sheet, r.row, r.asin, r.name, r.rv.verdict, r.rv.earned, r.rv.verifiedMax, r.rv.unverPts, r.rv.note].map(q).join(',')));
    save(new Blob([lines.join('\n')], { type: 'text/csv' }), 'PFIC-review-summary.csv');
  });
})();
