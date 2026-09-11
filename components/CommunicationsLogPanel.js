'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

const PAGE_SIZE = 50;

const CATEGORY_LABELS = {
  general: 'General',
  proposal: 'Proposal',
  contract: 'Contract',
  'change order': 'Change Order',
  invoice: 'Invoice',
  update: 'Project Update',
  document: 'Document',
  material_selection: 'Material Selection',
  work_order: 'Work Order (Customer)',
  subcontractor_work_order: 'Work Order (Subcontractor)',
  review_request: 'Review Request',
  portal_invite: 'Portal Invite',
  staff_invite: 'Staff Invite',
  subcontractor_invite: 'Subcontractor Invite',
  subcontractor_application_approved: 'Application Approved',
  subcontractor_application_declined: 'Application Declined',
  opportunity_followup: 'Opportunity Follow-up',
  schedule_reminder: 'Schedule Reminder',
};

function categoryLabel(c) {
  return CATEGORY_LABELS[c] || (c ? c.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) : 'General');
}

function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function CommunicationsLogPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (pageNum, searchTerm, status, category) => {
    setLoading(true);
    setError('');
    let query = supabase
      .from('communications_log')
      .select('*, jobs(job_number, customer_name)')
      .order('sent_at', { ascending: false })
      .range(pageNum * PAGE_SIZE, pageNum * PAGE_SIZE + PAGE_SIZE); // fetch one extra to detect "has more"

    if (status !== 'all') query = query.eq('status', status);
    if (category !== 'all') query = query.eq('category', category);
    if (searchTerm.trim()) {
      const term = searchTerm.trim();
      query = query.or(`to_email.ilike.%${term}%,subject.ilike.%${term}%,sent_by.ilike.%${term}%`);
    }

    const { data, error: err } = await query;
    if (err) {
      setError(err.message);
      setRows([]);
    } else {
      setHasMore((data || []).length > PAGE_SIZE);
      setRows((data || []).slice(0, PAGE_SIZE));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.from('communications_log').select('category').then(({ data }) => {
      if (data) setCategories(Array.from(new Set(data.map(r => r.category))).sort());
    });
  }, []);

  useEffect(() => {
    setPage(0);
    load(0, search, statusFilter, categoryFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, categoryFilter]);

  useEffect(() => {
    const t = setTimeout(() => { setPage(0); load(0, search, statusFilter, categoryFilter); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function changePage(delta) {
    const next = page + delta;
    if (next < 0) return;
    setPage(next);
    load(next, search, statusFilter, categoryFilter);
  }

  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
        Every email the system has sent — document notifications, portal and staff invites, work orders,
        review requests, and the automated follow-ups and schedule reminders — with who it went to, when, and whether it succeeded.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by email, subject, or sent by…"
          style={{ flex: '1 1 220px', minWidth: 180 }}
        />
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="all">All types</option>
          {categories.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: 150 }}>
          <option value="all">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
      {loading && <div className="empty-state">Loading…</div>}
      {!loading && rows.length === 0 && <div className="empty-state">No communications match these filters.</div>}

      {!loading && rows.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Sent</th>
                <th style={{ width: 190 }}>To</th>
                <th>Subject</th>
                <th style={{ width: 150 }}>Type</th>
                <th style={{ width: 130 }}>Job</th>
                <th style={{ width: 150 }}>Sent By</th>
                <th style={{ width: 80 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  onClick={() => { if (r.job_id) window.location.href = `/jobs/${r.job_id}`; }}
                  style={{ cursor: r.job_id ? 'pointer' : 'default' }}
                  title={r.error_message || undefined}
                >
                  <td>{fmtDateTime(r.sent_at)}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.to_email}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subject || '—'}</td>
                  <td>{categoryLabel(r.category)}</td>
                  <td>{r.jobs ? `#${r.jobs.job_number}` : '—'}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sent_by || '—'}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 600, color: r.status === 'sent' ? '#3a6b45' : '#a13f3f' }}>
                      {r.status === 'sent' ? 'Sent' : 'Failed'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (page > 0 || hasMore) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <button className="btn btn-sm" onClick={() => changePage(-1)} disabled={page === 0}>← Newer</button>
          <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Page {page + 1}</span>
          <button className="btn btn-sm" onClick={() => changePage(1)} disabled={!hasMore}>Older →</button>
        </div>
      )}
    </div>
  );
}
