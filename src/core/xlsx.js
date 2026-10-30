// Minimal XLSX writer (real .xlsx, opens cleanly in Excel / Google Sheets / LibreOffice). No external deps besides fflate.
import { zipSync, strToU8 } from 'fflate';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function colRef(i) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/**
 * sheets: [{ name, title?, columns: [{ header, key, width?, type?: 'n'|'s', dp? }], rows: [obj] }]
 * Returns a Blob.
 */
export function buildXlsx(sheets, { creator = 'Review 3D by Yan Malegi Diardi' } = {}) {
  const files = {};
  const sheetEntries = sheets.map((sh, i) => ({ ...sh, idx: i + 1, safe: esc(String(sh.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)) }));

  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetEntries.map((s) => `<Override PartName="/xl/worksheets/sheet${s.idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  files['docProps/core.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${esc(creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.map((s) => `<sheet name="${s.safe}" sheetId="${s.idx}" r:id="rId${s.idx}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries.map((s) => `<Relationship Id="rId${s.idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.idx}.xml"/>`).join('')}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // styles: 0 default, 1 header (bold white on dark), 2 number 2dp, 3 title bold, 4 integer, 5 number 3dp
  files['xl/styles.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.000"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="13"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF151227"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBBBBBB"/></left><right style="thin"><color rgb="FFBBBBBB"/></right><top style="thin"><color rgb="FFBBBBBB"/></top><bottom style="thin"><color rgb="FFBBBBBB"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);

  for (const s of sheetEntries) {
    const rowsXml = [];
    let r = 1;
    if (s.title) {
      rowsXml.push(`<row r="${r}"><c r="A${r}" t="inlineStr" s="3"><is><t>${esc(s.title)}</t></is></c></row>`);
      r += 2;
    }
    const headerRow = r;
    rowsXml.push(`<row r="${r}">${s.columns.map((c, ci) => `<c r="${colRef(ci)}${r}" t="inlineStr" s="1"><is><t>${esc(c.header)}</t></is></c>`).join('')}</row>`);
    r++;
    for (const row of s.rows) {
      const cells = s.columns.map((c, ci) => {
        const v = typeof c.key === 'function' ? c.key(row) : row[c.key];
        const ref = `${colRef(ci)}${r}`;
        if (v == null || v === '') return `<c r="${ref}" s="0"/>`;
        if ((c.type === 'n' || typeof v === 'number') && isFinite(Number(v)) && v !== true && v !== false) {
          const st = c.dp === 0 ? 4 : c.dp === 3 ? 5 : c.type === 'n' ? 2 : 0;
          return `<c r="${ref}" s="${st}"><v>${Number(v)}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr" s="0"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      rowsXml.push(`<row r="${r}">${cells}</row>`);
      r++;
    }
    const cols = `<cols>${s.columns.map((c, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${c.width || Math.max(10, String(c.header).length + 4)}" customWidth="1"/>`).join('')}</cols>`;
    const lastCol = colRef(Math.max(0, s.columns.length - 1));
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rowsXml.join('')}</sheetData>${s.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${headerRow + s.rows.length}"/>` : ''}</worksheet>`;
    files[`xl/worksheets/sheet${s.idx}.xml`] = strToU8(xml);
  }
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// --- CSV import (auto-detects , ; or tab — Indonesian Excel exports with ;) ---
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const cand = [',', ';', '\t'];
  const delim = cand.map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
