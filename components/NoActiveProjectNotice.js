'use client';
import { SUPPORT_EMAIL } from '../lib/constants';

// Shown when a customer's session is valid but they have no visible job —
// either they were never linked to one, or their only project was closed
// out (see has_job_portal_access, migration 070). Same message either
// way; we don't distinguish "never had one" from "used to have one" since
// that distinction isn't the customer's problem to reason about — either
// way the right next step is the same: reach out.
export default function NoActiveProjectNotice() {
  return (
    <div className="container" style={{ paddingTop: 24 }}>
      <div className="card" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
        <h3 style={{ marginTop: 0 }}>No active project</h3>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
          It looks like you don't have an active project with McLoud Construction right now.
          If this doesn't seem right, reach out and we'll sort it out.
        </p>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-primary btn-sm">Email us</a>
      </div>
    </div>
  );
}
