'use client';
import { formattedProjectNumber } from '../lib/constants';

export default function PortalJobSwitcher({ jobs, selectedJobId, setSelectedJobId }) {
  if (jobs.length === 0) {
    return <div className="empty-state">No projects are linked to this email yet. If you're expecting to see one, reach out to McLoud Construction.</div>;
  }
  if (jobs.length === 1) return null;
  return (
    <div className="stage-tabs">
      {jobs.map(j => (
        <button key={j.id} className={`stage-tab ${j.id === selectedJobId ? 'active' : ''}`} onClick={() => setSelectedJobId(j.id)}>
          {formattedProjectNumber(j)}
        </button>
      ))}
    </div>
  );
}
