/* PFIC – spreadsheet helpers (ExcelJS). Reads product rows, writes ONLY the Coach Notes cell. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFICSheet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const cellText = (cell) => {
    let v = cell && cell.value;
    if (v == null) return '';
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map((t) => t.text).join('');
      if (v.result !== undefined) v = v.result;
      else if (v.text !== undefined) v = v.text;
      else if (v instanceof Date) return v.toISOString().slice(0, 10);
    }
    return v == null ? '' : typeof v === 'object' ? '' : String(v).trim();
  };
  const cellRaw = (cell) => {
    let v = cell && cell.value;
    if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
    if (v && typeof v === 'object' && v.text !== undefined) v = v.text;
    return v == null || typeof v === 'object' ? null : v;
  };

  const FIELD_RULES = [
    ['asin', /\basin\b/i],
    ['notes', /coach\s*notes?/i],
    ['reviewStatus', /coach\s*review\s*status/i],
    ['name', /product\s*(name|title)|^product$|^name$|^title$/i],
    ['brand', /^brand/i],
    ['landed', /landed/i],
    ['cost', /(offered\s*)?unit\s*cost|supplier\s*(unit\s*)?(cost|price)|cost\s*per\s*unit|buy\s*price|cost\s*price|^cost$/i],
    ['shipping', /inbound|shipping|freight/i],
    ['referral', /referral/i],
    ['fba', /fba\s*fee|fulfil?ment\s*fee|^fba$/i],
    ['moq', /moq|minimum\s*order/i],
    ['supplier', /supplier\s*(name|website)|^supplier$/i],
    ['elig', /eligib|ungat|seller\s*central\s*status/i],
    ['price', /current\s*(selling\s*)?price|buy\s*box\s*price|selling\s*price|^price$|sell\s*price/i]
  ];

  function mapHeaders(ws, rowNum) {
    const cols = {}, used = new Set();
    const row = ws.getRow(rowNum);
    FIELD_RULES.forEach(([key, re]) => {
      for (let c = 1; c <= Math.max(ws.columnCount, 60); c++) {
        if (used.has(c)) continue;
        const t = cellText(row.getCell(c));
        if (t && re.test(t)) { cols[key] = c; used.add(c); break; }
      }
    });
    return cols;
  }

  function findTables(wb) {
    const out = [];
    wb.eachSheet((ws) => {
      for (let r = 1; r <= Math.min(25, ws.rowCount); r++) {
        const cols = mapHeaders(ws, r);
        if (cols.asin) {
          const rows = [];
          for (let i = r + 1; i <= Math.min(ws.rowCount, r + 600); i++) {
            const raw = cellText(ws.getRow(i).getCell(cols.asin)).toUpperCase().replace(/\s/g, '');
            if (!/^[A-Z0-9]{10}$/.test(raw) || !/\d/.test(raw)) continue;
            const data = { asin: raw };
            Object.keys(cols).forEach((k) => { if (k !== 'asin') data[k] = k === 'notes' || k === 'reviewStatus' ? cellText(ws.getRow(i).getCell(cols[k])) : cellRaw(ws.getRow(i).getCell(cols[k])); });
            const nm = String(data.name || '').toLowerCase();
            if (/^(example|sample|e\.g\.)/.test(nm)) continue;
            rows.push({ rowNum: i, data });
          }
          out.push({ sheetName: ws.name, ws, headerRow: r, cols, rows, hasNotes: !!cols.notes });
          break;
        }
      }
    });
    return out;
  }

  // Writes only the Coach Notes cell of each product row (appends under any existing note).
  function writeNotes(tables, notes) {
    let written = 0;
    tables.forEach((t) => {
      if (!t.hasNotes) return;
      t.rows.forEach((r) => {
        const n = notes[t.sheetName + '!' + r.rowNum];
        if (!n) return;
        const cell = t.ws.getRow(r.rowNum).getCell(t.cols.notes);
        const existing = cellText(cell);
        cell.value = existing ? existing + '\n\n' + n : n;
        cell.alignment = Object.assign({}, cell.alignment || {}, { wrapText: true, vertical: 'top' });
        written++;
      });
    });
    return written;
  }

  return { findTables, writeNotes, cellText };
});
