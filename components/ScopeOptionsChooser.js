'use client';

function fmtMoneyPlain(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Rendered INSIDE the estimate document's own "Scope of work" section
// (via ProposalDocument's scopeOptionsSlot), not as a separate box below
// the document — so it shows up in exactly that spot on screen, in the
// downloaded PDF, and on paper, not just as an interactive extra. Picking
// still works here (on screen); the Submit button and running total live
// in the interactive box below the document instead, since those aren't
// meaningful on a printed page.
export default function ScopeOptionsChooser({ options, localSelectedOptionId, isAdmin, locked, picking, onPick }) {
  if (!options || options.length === 0) {
    return <ul className="doc-list"><li className="empty">No scope options added yet.</li></ul>;
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, fontStyle: 'italic', color: '#6b6350', marginBottom: 12 }}>
        This project has more than one way it could go. Only one of the options below moves forward
        {isAdmin ? ' — the customer picks on this page.' : locked ? '.' : ' — choose one, then submit your selections below.'}
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        {options.map(o => {
          const isChosen = localSelectedOptionId === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={isAdmin || locked || picking === o.id}
              onClick={() => onPick(o.id)}
              style={{
                textAlign: 'left', padding: '14px 16px', borderRadius: 6, cursor: isAdmin || locked ? 'default' : 'pointer',
                border: isChosen ? '2px solid #9B773D' : '1px solid #ded7c0',
                background: isChosen ? '#fff' : '#fdfcf8',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5, color: '#1C1B19' }}>{isChosen ? '● ' : '○ '}{o.label}</span>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: '#1C1B19', whiteSpace: 'nowrap' }}>{fmtMoneyPlain(o.price)}</span>
              </div>
              {o.description && <div style={{ fontSize: 11.5, color: '#6b6350', marginTop: 4 }}>{o.description}</div>}
              {(o.scope_items || []).length > 0 && (
                <ul className="doc-list" style={{ marginTop: 8 }}>
                  {o.scope_items.map((it, i) => <li key={i}>{it.text}</li>)}
                </ul>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
