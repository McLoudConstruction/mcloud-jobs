'use client';
import InboxConversations from './InboxConversations';

// The job's Inbox is just the conversation list — emails, portal messages and
// subcontractor messages for this project, all in one place.
export default function JobInbox({ jobId, job, session }) {
  return <InboxConversations session={session} jobId={jobId} job={job} />;
}
