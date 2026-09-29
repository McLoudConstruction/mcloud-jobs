'use client';
import { useState } from 'react';
import JobMessagesCard from './JobMessagesCard';
import EmailConversations from './EmailConversations';

// The job's own inbox: customer portal messages and email conversations for
// this one project, side by side under one button (it used to be a separate
// Email tab).
export default function JobInbox({ jobId, job, session }) {
  const [view, setView] = useState('email');
  return (
    <div>
      <div className="tab-sections-pills" style={{ marginBottom: 12 }}>
        <button type="button" className={`tab-section-btn ${view === 'email' ? 'active' : ''}`} onClick={() => setView('email')}>Email</button>
        <button type="button" className={`tab-section-btn ${view === 'portal' ? 'active' : ''}`} onClick={() => setView('portal')}>Portal messages</button>
      </div>
      {view === 'email' ? <EmailConversations session={session} jobId={jobId} job={job} /> : <JobMessagesCard jobId={jobId} job={job} />}
    </div>
  );
}
