'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import DriveModePropertyInfo from './DriveModePropertyInfo';
import DriveModeQuickActions from './DriveModeQuickActions';
import { getPreferredMapsProvider, setPreferredMapsProvider, mapsUrlFor } from '../lib/salesRoutes';
import { isPending, formatClock, formatMinutes } from '../lib/routeTiming';

// Same Google Font ('Big Shoulders', not the separate 'Big Shoulders
// Display' family) and same @import-in-a-<style>-tag approach already
// used for the marketing-style headline in ProposalDocument.js — plain
// CSS rather than next/font, so a blocked/slow font host just falls back
// to the sans-serif default instead of failing anything.

const PROVIDERS = [
  { key: 'apple', label: 'Apple Maps' },
  { key: 'google', label: 'Google Maps' },
  { key: 'waze', label: 'Waze' },
];

function formatAddress(p) {
  return [p.property_street, p.property_city, p.property_state, p.property_zip].filter(Boolean).join(', ');
}

// Full-viewport fixed overlay rather than the browser Fullscreen API —
// iOS Safari doesn't support requestFullscreen() on a plain element (only
// on <video>), and this app is used installed as a PWA, so a fixed,
// inset:0 layer is the one approach that actually works everywhere.
export default function DriveModeOverlay({
  stops, endLabel, staffId, routeId, properties, eta,
  onExit, onMarkVisited, onUndoVisit, onSkip, onUnskip, onQuickAdd, onFinish,
}) {
  const [mounted, setMounted] = useState(false);
  const [provider, setProvider] = useState('apple');

  useEffect(() => {
    setMounted(true);
    setProvider(getPreferredMapsProvider());
  }, []);

  if (!mounted) return null;

  // Skipped stops are off this route, so they do not count toward "Stop X of Y".
  const currentIndex = stops.findIndex(isPending);
  const current = currentIndex === -1 ? null : stops[currentIndex];
  const liveStops = stops.filter(s => !s.skipped_at);
  const remainingCount = stops.filter(isPending).length;
  const position = current ? liveStops.indexOf(current) + 1 : 0;
  const address = current ? formatAddress(current) : '';
  // All stops visited, but there's a saved end location — that becomes
  // the final "next stop" rather than jumping straight to a completion
  // screen. It's never part of `stops` itself (not shown in the list
  // view), it only surfaces here once the real stops are done.
  const showEndAsNext = !current && !!endLabel;

  // Undo always means "un-mark the most recently visited stop", for the
  // accidental tap on "Mark Visited" while still driving to the next stop.
  const lastVisitedIndex = stops.map(s => !!s.visited_at).lastIndexOf(true);
  const canUndo = lastVisitedIndex >= 0;

  // The stop skipped most recently can be put back.
  let lastSkippedIndex = -1;
  stops.forEach((s, i) => {
    if (!s.skipped_at || s.visited_at) return;
    if (lastSkippedIndex === -1 || new Date(s.skipped_at) > new Date(stops[lastSkippedIndex].skipped_at)) lastSkippedIndex = i;
  });
  const canUnskip = lastSkippedIndex >= 0 && !!onUnskip;

  function changeProvider(p) {
    setProvider(p);
    setPreferredMapsProvider(p);
  }

  return createPortal(
    <div style={overlayStyle}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@700;800&display=swap');`}</style>
      <button onClick={onExit} style={exitBtnStyle} aria-label="Exit drive mode">×</button>

      {current ? (
        <div style={contentStyle}>
          <div style={progressStyle}>Stop {position} of {liveStops.length}</div>
          <div style={headlineStyle}>Next Stop</div>
          <div style={nameStyle}>{current.property_name}</div>
          {(current.property_type || current.management_company) && (
            <div style={metaStyle}>
              {[current.property_type, current.management_company].filter(Boolean).join(' · ')}
            </div>
          )}
          {address ? (
            <a href={mapsUrlFor(provider, address)} target="_blank" rel="noreferrer" style={addressStyle}>
              {address}
            </a>
          ) : (
            <div style={{ ...addressStyle, opacity: 0.55, textDecoration: 'none' }}>No address on file</div>
          )}
          {eta && eta.nextArrival && (
            <div style={etaStyle}>
              Arrive about {formatClock(eta.nextArrival)}
              {eta.nextDriveSeconds != null ? ` · ${formatMinutes(eta.nextDriveSeconds / 60)} drive` : ''}
              {eta.nextDwellMinutes ? ` · ${formatMinutes(eta.nextDwellMinutes)} planned at the stop` : ''}
            </div>
          )}

          <div style={actionsStyle}>
            <button className="btn btn-primary" style={bigButtonStyle} onClick={() => onMarkVisited(currentIndex)}>
              {remainingCount === 1 ? 'Mark Visited & Finish' : 'Mark Visited & Next →'}
            </button>
            {onSkip && (
              <>
                <button type="button" style={skipButtonStyle} onClick={() => onSkip(currentIndex)}>
                  Skip Stop
                </button>
                <div style={skipHintStyle}>Takes it off this route only. It stays in your property list.</div>
              </>
            )}
            {canUndo && (
              <button type="button" style={undoLinkStyle} onClick={() => onUndoVisit(lastVisitedIndex)}>
                ↺ Undo visit to {stops[lastVisitedIndex].property_name}
              </button>
            )}
            {canUnskip && (
              <button type="button" style={undoLinkStyle} onClick={() => onUnskip(lastSkippedIndex)}>
                ↺ Put {stops[lastSkippedIndex].property_name} back on the route
              </button>
            )}
          </div>
          {eta && eta.finishAt && remainingCount > 1 && (
            <div style={{ ...etaStyle, marginTop: 18 }}>
              {remainingCount} stops left · route done around {formatClock(eta.finishAt)}
            </div>
          )}
          <DriveModeQuickActions
            stop={current}
            stops={stops}
            staffId={staffId}
            routeId={routeId}
            properties={properties}
            onQuickAdd={onQuickAdd}
          />
          <DriveModePropertyInfo key={current.property_id || currentIndex} stop={current} />
        </div>
      ) : showEndAsNext ? (
        <div style={contentStyle}>
          <div style={progressStyle}>Final Stop</div>
          <div style={headlineStyle}>Next Stop</div>
          <div style={nameStyle}>{endLabel}</div>
          <a href={mapsUrlFor(provider, endLabel)} target="_blank" rel="noreferrer" style={addressStyle}>
            {endLabel}
          </a>

          <div style={actionsStyle}>
            <button className="btn btn-primary" style={bigButtonStyle} onClick={onFinish}>Arrived — Finish Route</button>
            {canUndo && (
              <button type="button" style={undoLinkStyle} onClick={() => onUndoVisit(lastVisitedIndex)}>
                ↺ Undo visit to {stops[lastVisitedIndex].property_name}
              </button>
            )}
            {canUnskip && (
              <button type="button" style={undoLinkStyle} onClick={() => onUnskip(lastSkippedIndex)}>
                ↺ Put {stops[lastSkippedIndex].property_name} back on the route
              </button>
            )}
          </div>
          <DriveModeQuickActions stop={null} stops={stops} staffId={staffId} routeId={routeId} properties={properties} onQuickAdd={onQuickAdd} />
        </div>
      ) : (
        <div style={contentStyle}>
          <div style={headlineStyle}>Route Complete</div>
          <div style={nameStyle}>Every stop is visited or skipped.</div>
          <div style={actionsStyle}>
            <button className="btn btn-primary" style={bigButtonStyle} onClick={onFinish}>Finish Route</button>
            {canUndo && (
              <button type="button" style={undoLinkStyle} onClick={() => onUndoVisit(lastVisitedIndex)}>
                ↺ Undo visit to {stops[lastVisitedIndex].property_name}
              </button>
            )}
            {canUnskip && (
              <button type="button" style={undoLinkStyle} onClick={() => onUnskip(lastSkippedIndex)}>
                ↺ Put {stops[lastSkippedIndex].property_name} back on the route
              </button>
            )}
          </div>
          <DriveModeQuickActions stop={null} stops={stops} staffId={staffId} routeId={routeId} properties={properties} onQuickAdd={onQuickAdd} />
        </div>
      )}

      <div style={providerRowStyle}>
        <label htmlFor="drive-mode-maps-provider" style={providerLabelStyle}>Open stops in</label>
        <select
          id="drive-mode-maps-provider"
          value={provider}
          onChange={e => changeProvider(e.target.value)}
          style={providerSelectStyle}
        >
          {PROVIDERS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
    </div>,
    document.body
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 2000,
  background: '#14120f', color: '#f3ede0',
  display: 'flex', flexDirection: 'column',
  paddingTop: 'max(20px, env(safe-area-inset-top))',
  paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
  paddingLeft: 'max(20px, env(safe-area-inset-left))',
  paddingRight: 'max(20px, env(safe-area-inset-right))',
};
const exitBtnStyle = {
  position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', right: 'max(16px, env(safe-area-inset-right))',
  background: 'rgba(255,255,255,0.08)', border: 'none', color: '#f3ede0',
  width: 40, height: 40, borderRadius: '50%', fontSize: 22, lineHeight: 1, cursor: 'pointer',
};
const contentStyle = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'safe center', textAlign: 'center', padding: '0 24px', overflowY: 'auto', minHeight: 0 };
const progressStyle = { fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 18 };
const headlineStyle = { fontFamily: "'Big Shoulders', sans-serif", fontWeight: 800, fontSize: 'clamp(42px, 13vw, 76px)', textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1, color: '#9b773d' };
const nameStyle = { fontSize: 'clamp(20px, 6vw, 32px)', fontWeight: 600, marginTop: 16, maxWidth: 600 };
const metaStyle = { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 6 };
const addressStyle = { display: 'inline-block', marginTop: 16, fontSize: 16, color: '#f3ede0', textDecoration: 'underline', textUnderlineOffset: 4 };
const actionsStyle = { marginTop: 44, width: '100%', maxWidth: 360 };
const bigButtonStyle = { width: '100%', padding: '18px 0', fontSize: 16, borderRadius: 10, justifyContent: 'center', textAlign: 'center' };
const skipButtonStyle = {
  display: 'block', width: '100%', marginTop: 12, padding: '12px 0',
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10,
  color: '#f3ede0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
const etaStyle = { marginTop: 14, fontSize: 14, color: 'rgba(243,237,224,0.78)', maxWidth: 420 };
const skipHintStyle = { marginTop: 6, fontSize: 11.5, color: 'rgba(255,255,255,0.5)', textAlign: 'center' };
const undoLinkStyle = {
  display: 'block', width: '100%', marginTop: 14, padding: '10px 0',
  background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)',
  fontSize: 13, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer',
};

// Bottom-anchored, out of the way of the main content — a dropdown
// rather than a row of buttons since this is a set-it-once preference,
// not something switched mid-drive.
const providerRowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  paddingTop: 16, marginTop: 'auto',
};
const providerLabelStyle = { fontSize: 12, color: 'rgba(255,255,255,0.55)' };
const providerSelectStyle = {
  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.28)', color: '#f3ede0',
  borderRadius: 6, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit',
};
