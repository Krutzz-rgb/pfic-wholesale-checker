const path = require('path');
const assert = require('assert');
const ExcelJS = require('exceljs');
const PFIC = require('../site/analysis.js');
const Sheet = require('../site/sheet.js');

const NOW = Date.UTC(2026, 9, 13, 10, 0, 0);
const nowK = PFIC.msToK(NOW);
const day = 1440;

// ---- mock Keepa product builder ----
function mock({ price = 2000, drop = 0, amazonShare = 0, thirdIds = ['S1', 'S2'], drops = [40, 45, 42], fba = 4 }) {
  const csv = [];
  const bb = [], rank = [];
  for (let d = 90; d >= 0; d -= 3) { const t = nowK - d * day; const f = 1 - drop * (90 - d) / 90; bb.push(t, Math.round(price * f)); }
  csv[18] = bb;
  let r = 5000;
  [0, 1, 2].forEach((b) => { for (let i = 0; i < drops[b]; i++) { const t = nowK - (90 - b * 30) * day + Math.floor((i / drops[b]) * 29 * day) + 1; rank.push(t, 5400); rank.push(t + 60, 5000); } /* up then down = one drop */ });
  const pairsArr = []; for (let i = 0; i < rank.length; i += 2) pairsArr.push([rank[i], rank[i + 1]]); pairsArr.sort((a, b) => a[0] - b[0]);
  csv[3] = pairsArr.flat();
  // Buy Box history: time-slice by share
  const hist = []; const slices = 30; const unit = 90 * day / slices;
  for (let i = 0; i < slices; i++) { const t = Math.round(nowK - 90 * day + i * unit); const isAz = i < Math.round(slices * amazonShare / 100); hist.push(t, isAz ? PFIC.AMAZON_UK_SELLER : thirdIds[i % thirdIds.length]); }
  const offers = Array.from({ length: fba }, (_, i) => ({ isFBA: true, isAmazon: false, sellerId: 'X' + i, lastSeen: nowK - 100, condition: 1 }));
  return { asin: 'B0TESTGOOD', title: 'Test Brand Thing 500ml', brand: 'TestBrand', csv, buyBoxSellerIdHistory: hist, offers,
    stats: { current: Object.assign([], { 0: -1, 1: price, 11: 8, 18: Math.round(price * (1 - drop)) }), avg90: Object.assign([], { 1: price, 18: Math.round(price * (1 - drop / 2)) }), salesRankDrops30: drops[2], salesRankDrops90: drops.reduce((a, b) => a + b, 0) } };
}

(async () => {
  // ---- build a student-style workbook ----
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Wholesale Research');
  ws.getCell('A1').value = 'Student wholesale research sheet';
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1F6FEB' } };
  const H = ['Product Name', 'ASIN', 'Brand', 'Current Price', 'Supplier Name', 'Offered Unit Cost', 'Shipping per unit', 'Referral Fee', 'FBA Fee', 'MOQ', 'Seller Central Eligibility', 'Profit (calc)', 'Coach Notes', 'Coach Review Status'];
  ws.addRow([]); ws.addRow(H);
  ws.getRow(3).font = { bold: true }; ws.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
  ws.addRow(['Example product (delete me)', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  ws.addRow(['Good Thing 500ml', 'B0TESTGOOD', 'TestBrand', 20, 'ABC Wholesale Ltd', 8, 0.5, '15%', 3.2, 24, 'Eligible', { formula: 'D5-F5', result: 12 }, '', 'Pending']);
  ws.addRow(['Dead Thing', 'B0TESTDEAD', 'Brand2', 10, '', 9, 1, '15%', 3, 50, '', { formula: 'D6-F6', result: 1 }, 'Earlier note from last review', 'Pending']);
  ws.getCell('D5').numFmt = '£#,##0.00'; ws.getCell('D5').font = { color: { argb: 'FFFF0000' } };
  ws.getColumn(13).width = 60;
  const inBuf = await wb.xlsx.writeBuffer();

  // ---- run pipeline ----
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(inBuf);
  const tables = Sheet.findTables(wb2);
  assert.strictEqual(tables.length, 1); assert.strictEqual(tables[0].rows.length, 2, 'blank example row must be skipped');
  const keep = { B0TESTGOOD: mock({ price: 2000, drop: 0.04, amazonShare: 10, drops: [40, 45, 42], fba: 4 }), B0TESTDEAD: mock({ price: 1000, drop: 0.3, amazonShare: 98, drops: [4, 5, 3], fba: 1 }) };
  const S = { vat: 'yes' };
  const notes = {};
  tables[0].rows.forEach((r) => {
    const kd = PFIC.extractKeepa(keep[r.data.asin], NOW);
    const rv = PFIC.reviewProduct(r.data, kd, S, '13 Oct 2026');
    notes[tables[0].sheetName + '!' + r.rowNum] = rv.note;
    console.log('\n=== row', r.rowNum, r.data.asin, '→', rv.verdict, rv.earned + '/' + rv.verifiedMax, '(unverified pts ' + rv.unverPts + ') words=' + PFIC.words(rv.note));
    console.log(rv.note);
    Object.values(rv.checks).forEach((c) => console.log('  ', c.id, c.status, '-', c.detail));
  });
  Sheet.writeNotes(tables, notes);
  const outBuf = await wb2.xlsx.writeBuffer();

  // ---- verify preservation ----
  const wb3 = new ExcelJS.Workbook(); await wb3.xlsx.load(outBuf);
  const w3 = wb3.getWorksheet('Wholesale Research'), w0 = wb.getWorksheet('Wholesale Research');
  assert.deepStrictEqual(w3.getCell('L5').value, { formula: 'D5-F5', result: 12 }, 'formula preserved');
  assert.strictEqual(w3.getCell('D5').numFmt, '£#,##0.00'); assert.strictEqual(w3.getCell('D5').font.color.argb, 'FFFF0000');
  assert.strictEqual(w3.getCell('A1').font.bold, true);
  assert.strictEqual(w3.getRow(3).getCell(1).fill.fgColor.argb, 'FFFFE699');
  assert.strictEqual(w3.getColumn(13).width, 60);
  assert.strictEqual(w3.getCell('N5').value, 'Pending', 'Coach Review Status untouched');
  let changed = [];
  w0.eachRow({ includeEmpty: true }, (row, rn) => row.eachCell({ includeEmpty: true }, (c, cn) => { const a = JSON.stringify(c.value), b = JSON.stringify(w3.getCell(rn, cn).value); if (a !== b) changed.push(c.address); }));
  console.log('\nCells changed vs original:', changed.join(', '));
  assert.ok(changed.every((a) => /^M\d+$/.test(a)), 'only Coach Notes column changed');
  assert.ok(String(w3.getCell('M6').value).startsWith('Earlier note from last review\n\n'), 'existing note preserved + appended');
  console.log('\nALL ASSERTIONS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
