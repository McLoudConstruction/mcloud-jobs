'use client';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { exportToSheet, columnsToExport } from '../lib/exportToSheet';

// columns: [{ key, label, defaultWidth?, render?(row), filterValue?(row), sortValue?(row), filterable?, sortable?, stopClickPropagation?, sticky? }]
// sticky: true pins the column to the right edge of the table (header, filter
// row, and body cells) so it stays visible when the table scrolls horizontally
// — meant for a trailing actions column on wide tables.
//
// Export: pass exportFileName to show an "Export to Excel" button above the
// table. It exports exactly the rows currently shown (after column filters
// and sorting). Each column can set exportValue(row) to control its cell
// (falls back to filterValue, then row[key]) or exportable: false to leave it
// out. Pass exportColumns ([{ label, value(row) }]) to export a fuller set of
// fields than the table displays, e.g. addresses and notes.
// stickyHeader: keeps the column headings (and filter row) pinned to the top
// of the page's scroll area while the rows scroll underneath. The table then
// grows to its full height and the page scrolls, instead of the table having
// its own scroll box. onVisibleRowsChange(rows) reports the rows currently
// shown (after filters and sorting), e.g. so a page can export exactly those.
export default function DataTable({ columns, rows, onRowClick, getRowKey, rowClassName, exportFileName, exportSheetName, exportColumns, stickyHeader = false, onVisibleRowsChange }) {
  const [widths, setWidths] = useState(() => {
    // On a narrow viewport, start columns noticeably tighter so more of
    // the table is visible before scrolling — the user can still drag
    // any column back out afterward, this only affects the starting point.
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    const scale = isMobile ? 0.6 : 1;
    return Object.fromEntries(columns.map(c => [c.key, Math.round((c.defaultWidth || 160) * scale)]));
  });
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const resizing = useRef(null);

  // widths above is only computed once, at mount. A column added later —
  // e.g. a custom column created after this table is already on screen —
  // would otherwise have no entry here at all (undefined width) until a
  // full page reload remounted the table from scratch. This fills in a
  // default for any column that's missing one, without touching widths
  // for columns that already have a size (including ones the user's
  // dragged to a custom width).
  useEffect(() => {
    setWidths(prev => {
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
      const scale = isMobile ? 0.6 : 1;
      let changed = false;
      const next = { ...prev };
      for (const c of columns) {
        if (!(c.key in next)) {
          next[c.key] = Math.round((c.defaultWidth || 160) * scale);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.map(c => c.key).join(',')]);

  const onMouseMove = useCallback((e) => {
    if (!resizing.current) return;
    const { key, startX, startWidth } = resizing.current;
    const newWidth = Math.max(60, startWidth + (e.clientX - startX));
    setWidths(prev => ({ ...prev, [key]: newWidth }));
  }, []);

  const onMouseUp = useCallback(() => {
    resizing.current = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove]);

  function startResize(e, key) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startWidth: widths[key] };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  useEffect(() => () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove, onMouseUp]);

  function updateFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  function toggleSort(col) {
    if (col.sortable === false) return;
    setSort(prev => {
      if (prev.key !== col.key) return { key: col.key, dir: 'asc' };
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' };
      return { key: null, dir: 'asc' }; // third click clears back to natural order
    });
  }

  function sortRawValue(col, row) {
    if (col.sortValue) return col.sortValue(row);
    if (col.filterValue) return col.filterValue(row);
    return row[col.key];
  }

  const filteredRows = rows.filter(row =>
    columns.every(col => {
      if (col.filterable === false) return true;
      const f = (filters[col.key] || '').trim().toLowerCase();
      if (!f) return true;
      const val = col.filterValue ? col.filterValue(row) : (row[col.key] ?? '');
      return String(val).toLowerCase().includes(f);
    })
  );

  const sortedRows = useMemo(() => {
    if (!sort.key) return filteredRows;
    const col = columns.find(c => c.key === sort.key);
    if (!col) return filteredRows;
    const withIndex = filteredRows.map((row, i) => ({ row, i }));
    withIndex.sort((a, b) => {
      const av = sortRawValue(col, a.row);
      const bv = sortRawValue(col, b.row);
      const aEmpty = av === null || av === undefined || av === '';
      const bEmpty = bv === null || bv === undefined || bv === '';
      // Empty/missing values always sort to the end, regardless of
      // direction — otherwise ascending vs descending would flip whether
      // blanks show up first or last, which reads as broken either way.
      if (aEmpty && bEmpty) return a.i - b.i;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      let cmp;
      if (av instanceof Date || bv instanceof Date) cmp = new Date(av) - new Date(bv);
      else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      if (cmp === 0) cmp = a.i - b.i; // stable tiebreaker
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return withIndex.map(x => x.row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, sort, columns]);

  useEffect(() => {
    if (onVisibleRowsChange) onVisibleRowsChange(sortedRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedRows]);

  // Page level sticky header. A table that scrolls sideways is its own scroll
  // container, which stops CSS sticky from following the page, so the header
  // is nudged down by hand as the page scrolls.
  const wrapRef = useRef(null);
  const theadRef = useRef(null);
  useEffect(() => {
    if (!stickyHeader) return;
    const wrap = wrapRef.current;
    const thead = theadRef.current;
    if (!wrap || !thead) return;
    let scroller = wrap.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const target = scroller || window;
    let raf = 0;
    function update() {
      raf = 0;
      const topEdge = scroller ? scroller.getBoundingClientRect().top : 0;
      const box = wrap.getBoundingClientRect();
      const max = Math.max(0, box.height - thead.offsetHeight - 1);
      const delta = Math.min(Math.max(topEdge - box.top, 0), max);
      thead.style.transform = delta ? `translateY(${delta}px)` : '';
    }
    function onScroll() { if (!raf) raf = requestAnimationFrame(update); }
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      thead.style.transform = '';
    };
  }, [stickyHeader, sortedRows.length]);

  function handleExport() {
    exportToSheet({
      fileName: exportFileName,
      sheetName: exportSheetName || exportFileName,
      columns: exportColumns || columnsToExport(columns),
      rows: sortedRows,
    });
  }

  return (
    <>
    {exportFileName && sortedRows.length > 0 && (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button type="button" className="btn btn-sm" onClick={handleExport}>
          ↓ Export to Excel ({sortedRows.length})
        </button>
      </div>
    )}
    <div className={`data-table-wrap${stickyHeader ? ' data-table-wrap-page' : ''}`} ref={wrapRef}>
      <table className="data-table" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          {columns.map(c => <col key={c.key} style={{ width: widths[c.key] }} />)}
        </colgroup>
        <thead ref={theadRef}>
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                className={`${c.sortable === false ? '' : 'data-table-sortable-th'} ${c.sticky ? 'data-table-sticky-col' : ''}`}
                onClick={() => toggleSort(c)}
              >
                {c.label}
                {c.sortable !== false && (
                  <span className={`sort-indicator ${sort.key === c.key ? 'active' : ''}`}>
                    {sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                  </span>
                )}
                <span className="col-resize-handle" onMouseDown={e => startResize(e, c.key)} onClick={e => e.stopPropagation()} />
              </th>
            ))}
          </tr>
          <tr className="data-table-filter-row">
            {columns.map(c => (
              <th key={c.key} className={c.sticky ? 'data-table-sticky-col' : ''}>
                {c.filterable !== false && (
                  <input
                    className="data-table-filter-input"
                    placeholder="Filter…"
                    value={filters[c.key] || ''}
                    onChange={e => updateFilter(c.key, e.target.value)}
                    onClick={e => e.stopPropagation()}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => (
            <tr key={getRowKey(row)} onClick={() => onRowClick && onRowClick(row)} className={rowClassName ? rowClassName(row) : ''}>
              {columns.map(c => (
                <td
                  key={c.key}
                  className={c.sticky ? 'data-table-sticky-col' : ''}
                  onClick={c.stopClickPropagation ? (e => e.stopPropagation()) : undefined}
                >
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sortedRows.length === 0 && <div className="empty-state">No results match these filters.</div>}
    </div>
    </>
  );
}
