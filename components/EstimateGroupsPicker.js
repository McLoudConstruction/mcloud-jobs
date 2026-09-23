'use client';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '$0';
  const n = Number(v);
  return (n < 0 ? '-$' : '+$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtMoneyPlain(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// The interactive, no-print half of the flexible-estimate picker —
// Alternates (independently includable/deferrable add-ons), the running
// total, and the final Submit. The other half — the scope-options choice
// itself, when the job has more than one — lives INSIDE the printable
// document's own Scope of work section (ScopeOptionsChooser via
// ProposalDocument's scopeOptionsSlot), not here, so it shows up where a
// scope belongs on screen, in the PDF, and on paper. Both halves share
// one useEstimateGroupsPicker() instance (owned by the proposal page) so
// picks and totals stay in sync regardless of which half changed.
export default function EstimateGroupsPicker({ isAdmin, locked, isMulti, groups, alternatesTotal, runningTotal, optionRequirementMet, selectedOption, picking, submitting, error, toggle, submit }) {
  // Nothing to show at all: single scope, no alternates. In multi mode
  // this box still needs to render even with zero alternates — it's the
  // only place left to Submit and lock in the picked scope option.
  if (groups.length === 0 && !isMulti) return null;

  return (
    <div className="no-print" style={{ marginTop: 24, padding: '18px 24px', background: '#faf6ec', border: '1px solid #ded7c0', borderRadius: 8, maxWidth: 800, marginLeft: 'auto', marginRight: 'auto' }}>
      {groups.length > 0 && (
        <>
          <h3 style={{ margin: '0 0 4px', color: '#1C1B19' }}>Alternates</h3>
          {isAdmin ? (
            <div style={{ fontSize: 12, color: '#6b6350', marginBottom: 14 }}>
              Preview only — the customer picks these when they view this estimate. Build or edit alternates from the job's Estimate tab.
            </div>
          ) : locked ? (
            <div style={{ fontSize: 12, color: '#3a6b45', marginBottom: 14 }}>
              Your selections have been submitted and are reflected in the price and scope above.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#6b6350', marginBottom: 14 }}>
              Independently includable add-ons, on top of whichever scope is above. Review, then submit your picks — the total updates as you choose.
            </div>
          )}
        </>
      )}

      {groups.map(g => (
        <div key={g.id} style={{ marginBottom: 14 }}>
          <button
            type="button"
            disabled={isAdmin || locked || picking === g.id}
            onClick={() => toggle(g, !g.included)}
            style={{
              width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 6, cursor: isAdmin || locked ? 'default' : 'pointer',
              border: g.included ? '2px solid #9B773D' : '1px solid #ded7c0',
              background: g.included ? '#fff' : '#fdfcf8',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            }}
          >
            <span>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#1C1B19' }}>{g.included ? '☑ ' : '☐ '}{g.label}</span>
              {g.description && <span style={{ display: 'block', fontSize: 11.5, color: '#6b6350', marginTop: 2 }}>{g.description}</span>}
            </span>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#1C1B19', whiteSpace: 'nowrap' }}>{fmtMoney(g.price)}</span>
          </button>
        </div>
      ))}

      {groups.length === 0 && (isAdmin || locked) && (
        <div style={{ fontSize: 12, color: '#6b6350' }}>
          {isAdmin ? 'No alternates on this estimate.' : 'Your selection has been submitted and is reflected in the price and scope above.'}
        </div>
      )}

      {!isAdmin && !locked && (
        <div style={{ borderTop: groups.length > 0 ? '1px solid #ded7c0' : 'none', marginTop: groups.length > 0 ? 14 : 0, paddingTop: groups.length > 0 ? 14 : 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 14 }}>
            <span style={{ color: '#6b6350' }}>Estimated total with your picks: </span>
            <b style={{ fontSize: 17, color: '#1C1B19' }}>{fmtMoneyPlain(runningTotal)}</b>
          </div>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={!optionRequirementMet || submitting}>
            {submitting ? 'Submitting…' : optionRequirementMet ? 'Submit My Selections' : 'Choose a scope of work above'}
          </button>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 10 }}>{error}</div>}
    </div>
  );
}
