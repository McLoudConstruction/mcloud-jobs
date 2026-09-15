'use client';
import { useState } from 'react';
import ManualRouteBuilderCore from './ManualRouteBuilderCore';
import RouteBuilderCore from './RouteBuilderCore';

const MODES = [
  { key: 'manual', label: 'Manual' },
  { key: 'ai', label: 'AI-Powered' },
];

// One "Create Sales Route" card with a mode toggle, instead of the
// manual and AI-assisted builders sitting as two separate stacked
// cards. Both underlying components are unchanged — this just supplies
// a single shared card frame (via each core's `hideChrome` prop) and a
// bordered segmented control to switch between them.
export default function CombinedRouteBuilderCard({ onRouteChanged }) {
  const [mode, setMode] = useState('manual');

  return (
    <div className="card">
      <div className="tab-sections" style={{ margin: '0 0 16px' }}>
        <h3 style={{ margin: 0 }}>Create Sales Route</h3>
        <div className="tab-sections-pills">
          {MODES.map(m => (
            <button
              key={m.key}
              type="button"
              className={`tab-section-btn ${mode === m.key ? 'active' : ''}`}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'manual'
        ? <ManualRouteBuilderCore hideChrome onRouteChanged={onRouteChanged} />
        : <RouteBuilderCore hideChrome />}
    </div>
  );
}
