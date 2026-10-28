'use client';
import { useState } from 'react';
import FloorplanPanel from './FloorplanPanel';
import PlanTakeoffPanel from './PlanTakeoffPanel';

// The Sketch tab. It opens straight on the floorplan sketch tool
// (FloorplanPanel). "Upload existing sketch" is the other way to get a takeoff
// into the job: upload plan PDFs and the AI reads them and fills in Scope
// (PlanTakeoffPanel).
export default function PlansPanel({ jobId, embedded = false, onDone }) {
  const [uploading, setUploading] = useState(false);

  if (uploading) {
    return <PlanTakeoffPanel jobId={jobId} onBack={() => setUploading(false)} onDone={onDone} />;
  }

  return (
    <FloorplanPanel
      jobId={jobId}
      embedded={embedded}
      extraActions={<button type="button" className="btn btn-sm" onClick={() => setUploading(true)}>Upload existing sketch</button>}
    />
  );
}
