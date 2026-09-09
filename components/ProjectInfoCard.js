'use client';
import { useState } from 'react';

export default function ProjectInfoCard({ job, onSave }) {
  const [form, setForm] = useState({
    job_type: job.job_type || '',
    expected_close_date: job.expected_close_date || '',
    scheduled_start_date: job.scheduled_start_date || '',
    scheduled_end_date: job.scheduled_end_date || '',
    description: job.description || '',
    governing_state: job.governing_state || 'Missouri',
    project_type: job.project_type || 'residential',
  });
  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  function save() {
    const patch = { ...form };
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
          <label>Project type</label>
          <select value={form.project_type} onChange={e => update('project_type', e.target.value)}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
        <div><label>Job type</label><input value={form.job_type} onChange={e => update('job_type', e.target.value)} placeholder="e.g. Kitchen remodel" /></div>
        <div>
          <label>Expected close date</label>
          <input type="date" value={form.expected_close_date} onChange={e => update('expected_close_date', e.target.value)} />
        </div>
        <div>
          <label>Scheduled start date</label>
          <input type="date" value={form.scheduled_start_date} onChange={e => update('scheduled_start_date', e.target.value)} />
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
            Triggers automatic reminder emails to the customer 1 week and 1 day before this date.
          </div>
        </div>
        <div>
          <label>Scheduled end date</label>
          <input type="date" value={form.scheduled_end_date} onChange={e => update('scheduled_end_date', e.target.value)} min={form.scheduled_start_date || undefined} />
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>
            Used to draw this job's bar on the Calendar.
          </div>
        </div>
        <div>
          <label>Governing state</label>
          <select value={form.governing_state} onChange={e => update('governing_state', e.target.value)}>
            <option value="Missouri">Missouri</option>
            <option value="Kansas">Kansas</option>
          </select>
        </div>
      </div>
      <label>Description</label>
      <textarea value={form.description} onChange={e => update('description', e.target.value)} />
      <div className="section-actions">
        <button className="btn btn-primary btn-sm" onClick={save}>Save project overview</button>
      </div>
    </div>
  );
}
