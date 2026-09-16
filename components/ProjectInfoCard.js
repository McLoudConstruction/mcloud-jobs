'use client';
import { useState } from 'react';
import { phaseForStage } from '../lib/constants';

export default function ProjectInfoCard({ job, onSave, onTabChange }) {
  const [form, setForm] = useState({
    job_type: job.job_type || '',
    expected_close_date: job.expected_close_date || '',
    scheduled_start_date: job.scheduled_start_date || '',
    scheduled_end_date: job.scheduled_end_date || '',
    approved_at: job.approved_at ? job.approved_at.slice(0, 10) : '',
    description: job.description || '',
    governing_state: job.governing_state || 'Missouri',
    project_type: job.project_type || 'residential',
  });
  const approvedOrLater = phaseForStage(job.stage) !== 'opportunity';
  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  function save() {
    const patch = { ...form };
    // Postgres date columns reject '' outright ("invalid input syntax for
    // type date"); an empty/cleared date input must go through as null.
    for (const field of ['expected_close_date', 'scheduled_start_date', 'scheduled_end_date', 'approved_at']) {
      if (patch[field] === '') patch[field] = null;
      else if (field === 'approved_at' && patch[field]) patch[field] = new Date(patch[field] + 'T12:00:00').toISOString();
    }
    // Setting a scheduled start date while a job is Approved moves it to Scheduled automatically.
    if (job.stage === 'approved' && !job.scheduled_start_date && form.scheduled_start_date) {
      patch.stage = 'scheduled';
    }
    onSave(patch);
  }

  return (
    <div className="card">
      <h3>Project overview</h3>
      <div className="two-col">
        <div>
          <label>Customer type</label>
          <select value={form.project_type} onChange={e => update('project_type', e.target.value)}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
        <div><label>Job type</label><input value={form.job_type} onChange={e => update('job_type', e.target.value)} placeholder="e.g. Kitchen remodel" /></div>
        <div>
          <label>Date created</label>
          <input value={job.created_at ? new Date(job.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''} disabled style={{ opacity: 0.7 }} />
        </div>
        <div>
          <label>Expected close date</label>
          <input type="date" value={form.expected_close_date} onChange={e => update('expected_close_date', e.target.value)} />
        </div>
        <div>
          <label>Governing state</label>
          <select value={form.governing_state} onChange={e => update('governing_state', e.target.value)}>
            <option value="Missouri">Missouri</option>
            <option value="Kansas">Kansas</option>
          </select>
        </div>
      </div>

      {approvedOrLater && (
        <div className="two-col" style={{ marginTop: 12 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label>Scheduled start date</label>
              {onTabChange && (
                <button type="button" onClick={() => onTabChange('Customer', 'portal')}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                  Edit automatic customer reminders
                </button>
              )}
            </div>
            <input type="date" value={form.scheduled_start_date} onChange={e => update('scheduled_start_date', e.target.value)} />
          </div>
          <div>
            <label>Scheduled end date</label>
            <input type="date" value={form.scheduled_end_date} onChange={e => update('scheduled_end_date', e.target.value)} min={form.scheduled_start_date || undefined} />
          </div>
          <div>
            <label>Approved date</label>
            <input type="date" value={form.approved_at} onChange={e => update('approved_at', e.target.value)} />
          </div>
        </div>
      )}

      <label>Description</label>
      <textarea value={form.description} onChange={e => update('description', e.target.value)} />
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={save}>Save project overview</button>
      </div>
    </div>
  );
}

