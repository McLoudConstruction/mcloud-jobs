'use client';
import { useState } from 'react';
import MapRouteBuilderCore from './MapRouteBuilderCore';
import RouteBuilderCore from './RouteBuilderCore';

const MODES = [
  { key: 'manual', label: 'Manual' },
  { key: 'ai', label: 'AI-Powered' },
];

// One "Create Sales Route" card with a mode toggle. Manual is the map
// builder: pick properties on the map and/or type places in by hand, with
// the route drawn as you go. AI-Powered builds a route from area and
// property-type filters. Each core supplies its own content; this just
// provides the shared card frame (via each core's `hideChrome` prop) and the
// segmented control to switch between them.
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
        ? <MapRouteBuilderCore hideChrome onRouteChanged={onRouteChanged} />
        : <RouteBuilderCore hideChrome />}
    </div>
  );
}
