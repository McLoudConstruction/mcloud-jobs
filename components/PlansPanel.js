'use client';
import { useState } from 'react';
import FloorplanPanel from './FloorplanPanel';
import PlanTakeoffPanel from './PlanTakeoffPanel';

// Sell > Plans. Landing page offers two ways to get a takeoff into the job:
//   Build Your Own   the existing floorplan sketch tool (FloorplanPanel, unchanged)
//   Upload Plans     AI reads plan PDFs and fills in Scope (PlanTakeoffPanel)
export default function PlansPanel({ jobId, embedded = false, onDone }) {
  const [mode, setMode] = useState(null); // null | 'build' | 'upload'

  if (mode === 'build') {
    return (
      <div>
        <div style={{ marginBottom: 10 }}><button className="btn btn-sm" onClick={() => setMode(null)}>Back to Plans</button></div>
        <FloorplanPanel jobId={jobId} embedded={embedded} />
      </div>
    );
  }
  if (mode === 'upload') {
    return <PlanTakeoffPanel jobId={jobId} onBack={() => setMode(null)} onDone={onDone} />;
  }

  const option = { textAlign: 'left', padding: 18, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--panel)', display: 'block', width: '100%' };
  return (
    <div className="card">
      <h3>Plans</h3>
      <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '4px 0 16px' }}>Choose how to get quantities into this job.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <button type="button" style={option} onClick={() => setMode('build')}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--heading)' }}>Build Your Own</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6 }}>Sketch the floorplan yourself and get a material takeoff you can send to the estimate.</div>
        </button>
        <button type="button" style={option} onClick={() => setMode('upload')}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--heading)' }}>Upload Plans</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6 }}>Upload plan PDFs. The AI reads them and fills in Scope with quantities, and flags anything to verify.</div>
        </button>
      </div>
    </div>
  );
}
