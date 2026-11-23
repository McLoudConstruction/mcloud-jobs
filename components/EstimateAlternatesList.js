'use client';

function fmtAlt(v) {
  if (v === null || v === undefined || v === '') return '$0';
  const n = Number(v);
  return (n < 0 ? '-$' : '+$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Alternates, rendered INSIDE the estimate document's own "Scope of work"
// section, directly under the base scope (via ProposalDocument's
// alternatesSlot). Because it lives inside the document it shows up on
// screen, in the downloaded PDF, in the emailed PDF and on paper. On screen
// the customer can still tick each one; the running total and Submit button
// stay in the interactive box below the document.
//
// readOnly: no ticking (admin preview, or the public share link). The check
// glyphs are dropped when there is nothing to tick.
export default function EstimateAlternatesList({ groups, interactive, picking, onToggle, readOnly }) {
  if (!groups || groups.length === 0) return null;
  const canPick = !!interactive && !readOnly;

  return (
    <div className="doc-alternates">
      <h4 className="doc-alternates-title">Alternates</h4>
      <p className="doc-alternates-note">
        Optional add-ons. Each is a separate estimate that can be added to the scope above.
        {canPick ? ' Choose any one, several or none of them.' : ''}
      </p>
      <div className="doc-alternates-cards">
        {groups.map(g => {
          const on = !!g.included;
          const Wrapper = canPick ? 'button' : 'div';
          const wrapperProps = canPick
            ? { type: 'button', disabled: picking === g.id, onClick: () => onToggle(g, !on) }
            : {};
          return (
            <Wrapper
              key={g.id}
              {...wrapperProps}
              className="doc-alt-card"
              style={{
                textAlign: 'left', width: '100%', padding: '12px 14px', borderRadius: 6,
                cursor: canPick ? 'pointer' : 'default', fontFamily: 'inherit',
                border: canPick && on ? '2px solid #9B773D' : '1px solid #ded7c0',
                background: canPick && on ? '#fff' : '#fdfcf8',
                display: 'block', breakInside: 'avoid', marginBottom: 10, boxSizing: 'border-box',
              }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5, color: '#1C1B19' }}>
                  {canPick ? (on ? '☑ ' : '☐ ') : ''}{g.label}
                </span>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: '#1C1B19', whiteSpace: 'nowrap' }}>{fmtAlt(g.price)}</span>
              </span>
              {g.description && <span style={{ display: 'block', fontSize: 11.5, color: '#6b6350', marginTop: 4 }}>{g.description}</span>}
              {(g.scope_items || []).length > 0 && (
                <ul className="doc-list" style={{ marginTop: 8 }}>
                  {g.scope_items.map((it, i) => <li key={i}>{it.text}</li>)}
                </ul>
              )}
            </Wrapper>
          );
        })}
      </div>
    </div>
  );
}
