'use client';
import { useState, useRef, useCallback, useEffect } from 'react';

// columns: [{ key, label, defaultWidth?, render?(row), filterValue?(row), filterable?, stopClickPropagation? }]
export default function DataTable({ columns, rows, onRowClick, getRowKey }) {
  const [widths, setWidths] = useState(() => {
    // On a narrow viewport, start columns noticeably tighter so more of
    // the table is visible before scrolling — the user can still drag
    // any column back out afterward, this only affects the starting point.
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    const scale = isMobile ? 0.6 : 1;
    return Object.fromEntries(columns.map(c => [c.key, Math.round((c.defaultWidth || 160) * scale)]));
  });
  const [filters, setFilters] = useState({});
  const resizing = useRef(null);

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

  const filteredRows = rows.filter(row =>
    columns.every(col => {
      if (col.filterable === false) return true;
      const f = (filters[col.key] || '').trim().toLowerCase();
      if (!f) return true;
      const val = col.filterValue ? col.filterValue(row) : (row[col.key] ?? '');
      return String(val).toLowerCase().includes(f);
    })
  );

  return (
    <div className="data-table-wrap">
      <table className="data-table" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          {columns.map(c => <col key={c.key} style={{ width: widths[c.key] }} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key}>
                {c.label}
                <span className="col-resize-handle" onMouseDown={e => startResize(e, c.key)} />
              </th>
            ))}
          </tr>
          <tr className="data-table-filter-row">
            {columns.map(c => (
              <th key={c.key}>
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
          {filteredRows.map(row => (
            <tr key={getRowKey(row)} onClick={() => onRowClick && onRowClick(row)}>
              {columns.map(c => (
                <td key={c.key} onClick={c.stopClickPropagation ? (e => e.stopPropagation()) : undefined}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {filteredRows.length === 0 && <div className="empty-state">No results match these filters.</div>}
    </div>
  );
}
