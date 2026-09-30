import * as XLSX from 'xlsx';

// Downloads an .xlsx of the given rows.
//
// columns: [{ label, value(row) }]  value may return a string, number, boolean,
// Date, or null/undefined (exported as a blank cell). Numbers stay numeric so
// the sheet can be summed and sorted in Excel; booleans become Yes/No.
function cleanCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function todayStamp() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function exportToSheet({ fileName, sheetName, columns, rows }) {
  const header = columns.map(c => c.label);
  const body = rows.map(row => columns.map(c => cleanCell(c.value(row))));
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);

  // Size each column to its longest value, within sensible limits.
  sheet['!cols'] = header.map((label, i) => {
    let longest = String(label).length;
    for (const r of body) {
      const len = String(r[i] ?? '').length;
      if (len > longest) longest = len;
    }
    return { wch: Math.min(Math.max(longest + 2, 10), 50) };
  });
  // Filter dropdowns on the header row.
  if (body.length > 0) {
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };
  }

  const workbook = XLSX.utils.book_new();
  // Excel sheet names max out at 31 chars and reject : \ / ? * [ ]
  const safeSheet = (sheetName || fileName || 'Export').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, sheet, safeSheet);
  XLSX.writeFile(workbook, `${fileName || 'export'}-${todayStamp()}.xlsx`);
}

// Picks what a visible DataTable column should export for a row: an explicit
// exportValue first, then the same plain value the column filters on, then
// the raw field. Columns with no label (row action buttons) are skipped.
export function columnsToExport(tableColumns) {
  return tableColumns
    .filter(c => c.label && c.exportable !== false)
    .map(c => ({
      label: c.label,
      value: row => {
        if (c.exportValue) return c.exportValue(row);
        if (c.filterValue) return c.filterValue(row);
        return row[c.key];
      },
    }));
}

// Flattens custom columns (added via "Add column") into export columns.
export function customColumnsToExport(customColumns) {
  return (customColumns || []).map(col => ({
    label: col.label,
    value: row => row.custom_fields?.[col.column_key],
  }));
}
