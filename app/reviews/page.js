'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import { REVIEW_STATUS, holdLabel, starText, CATEGORY_LABELS } from '../../lib/reviews';

const FILTERS = [
  { key: 'follow', label: 'Needs follow-up' },
  { key: 'publish', label: 'Ready to publish' },
  { key: 'published', label: 'Published' },
  { key: 'received', label: 'All received' },
  { key: 'pending', label: 'Pending' },
];

function fmt(v) {
  return v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// Every review request in one place: what came back, who needs a call, and
// what goes on the website. What the customer wrote can't be edited here (the
// database refuses) — staff can only publish, unpublish, feature, and correct
// the display name and project label shown publicly.
export default function ReviewsPage() {
  const { session, loading } = useRequireAuth();
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('follow');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null); // { id, display_name, project_label }

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('reviews')
      .select('*, jobs(project_number, customer_name, project_address, job_type)')
      .order('created_at', { ascending: false });
    if (err) { setError(`${err.message} — make sure migration 138 has been run.`); return; }
    setError('');
    setRows(data || []);
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    load();
    const channel = supabase.channel('reviews-page').on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, load).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, load]);

  const received = useMemo(() => rows.filter(r => r.status === 'submitted'), [rows]);
  const stats = useMemo(() => {
    const avg = received.length ? received.reduce((a, r) => a + r.rating, 0) / received.length : null;
    const sent = rows.filter(r => r.status === 'sent' || r.status === 'submitted').length;
    return {
      avg,
      count: received.length,
      response: sent ? Math.round((received.length / sent) * 100) : null,
      follow: received.filter(r => r.needs_follow_up && !r.follow_up_done_at).length,
      google: received.filter(r => r.google_clicked_at).length,
    };
  }, [rows, received]);

  const visible = rows.filter(r => {
    if (filter === 'follow') return r.status === 'submitted' && r.needs_follow_up && !r.follow_up_done_at;
    if (filter === 'publish') return r.status === 'submitted' && r.publish_consent && !r.published;
    if (filter === 'published') return r.published;
    if (filter === 'received') return r.status === 'submitted';
    return r.status === 'scheduled' || r.status === 'sent';
  });

  async function patch(id, values) {
    setBusyId(id);
    const { error: err } = await supabase.from('reviews').update(values).eq('id', id);
    setBusyId(null);
    if (err) { setError(err.message); return false; }
    setError('');
    await load();
    return true;
  }

  async function saveEdit() {
    const ok = await patch(editing.id, { display_name: editing.display_name.trim() || null, project_label: editing.project_label.trim() || null });
    if (ok) setEditing(null);
  }

  async function followUp(r) {
    const note = window.prompt('Note about the follow-up (optional):', r.staff_note || '');
    if (note === null) return;
    await patch(r.id, { follow_up_done_at: new Date().toISOString(), staff_note: note.trim() || null });
  }

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container container-wide">
        <div className="top-actions"><h2 style={{ margin: 0, color: 'var(--heading)' }}>Reviews</h2></div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '4px 0 14px', maxWidth: 700, lineHeight: 1.55 }}>
          Private feedback from every completed project. Nothing appears on your website until you publish it and the customer has agreed to public use. The website&rsquo;s star average and count always include every review received, published or not.
        </div>
        {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Average rating', value: stats.avg ? stats.avg.toFixed(2) : '—' },
            { label: 'Reviews received', value: stats.count },
            { label: 'Response rate', value: stats.response === null ? '—' : `${stats.response}%` },
            { label: 'Need follow-up', value: stats.follow, warn: stats.follow > 0 },
            { label: 'Opened Google link', value: stats.google },
          ].map(t => (
            <div key={t.label} className="card" style={{ margin: 0, padding: '12px 14px' }}>
              <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: t.warn ? '#a13f3f' : 'var(--heading)' }}>{t.value}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{t.label}</div>
            </div>
          ))}
        </div>

        <div className="tab-sections-pills" style={{ marginBottom: 14 }}>
          {FILTERS.map(f => (
            <button key={f.key} type="button" className={`tab-section-btn${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>

        {visible.length === 0 && <div className="empty-state">Nothing here.</div>}

        {visible.map(r => {
          const j = r.jobs || {};
          const st = REVIEW_STATUS[r.status];
          const isEditing = editing?.id === r.id;
          return (
            <div key={r.id} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <Link href={`/jobs/${r.job_id}`} style={{ fontWeight: 700 }}>{j.customer_name || 'Customer'}</Link>
                  <span style={{ fontSize: 12, color: 'var(--ink-soft)', marginLeft: 8 }}>{j.project_number}{j.project_address ? ` · ${j.project_address}` : ''}</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 4, color: st.color, background: st.bg, alignSelf: 'flex-start' }}>{st.label}</span>
              </div>

              {r.status === 'submitted' ? (
                <>
                  <div style={{ margin: '8px 0 2px', color: '#c99a3a', fontSize: 20 }}>{starText(r.rating)}</div>
                  {r.comment ? <div style={{ fontSize: 13.5, lineHeight: 1.55, margin: '4px 0' }}>&ldquo;{r.comment}&rdquo;</div> : <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No written comment.</div>}
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                    {fmt(r.submitted_at)}
                    {Object.keys(r.category_ratings || {}).length > 0 && ' · ' + Object.entries(r.category_ratings).map(([k, v]) => `${CATEGORY_LABELS[k] || k} ${v}/5`).join(', ')}
                    {r.google_prompted && (r.google_clicked_at ? ' · opened Google link' : ' · offered Google')}
                  </div>
                  {r.staff_note && <div style={{ fontSize: 12, marginTop: 6, color: 'var(--ink-soft)' }}>Note: {r.staff_note}</div>}

                  {isEditing ? (
                    <div className="two-col" style={{ marginTop: 10 }}>
                      <div><label>Name shown publicly</label><input value={editing.display_name} onChange={e => setEditing({ ...editing, display_name: e.target.value })} /></div>
                      <div><label>Project shown publicly</label><input value={editing.project_label} onChange={e => setEditing({ ...editing, project_label: e.target.value })} /></div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 6 }}>
                      Shown as: <b>{r.display_name || '—'}</b>{r.project_label ? ` · ${r.project_label}` : ''}
                    </div>
                  )}

                  <div className="section-actions" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                    {r.needs_follow_up && !r.follow_up_done_at && (
                      <button className="btn btn-primary btn-sm" disabled={busyId === r.id} onClick={() => followUp(r)}>Mark follow-up done</button>
                    )}
                    {r.publish_consent ? (
                      <>
                        <button className={`btn btn-sm${r.published ? '' : ' btn-primary'}`} disabled={busyId === r.id} onClick={() => patch(r.id, { published: !r.published })}>
                          {r.published ? 'Unpublish' : 'Publish to website'}
                        </button>
                        {r.published && (
                          <button className="btn btn-sm" disabled={busyId === r.id} onClick={() => patch(r.id, { featured: !r.featured })}>{r.featured ? 'Unfeature' : 'Feature'}</button>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Customer didn&rsquo;t allow public use{r.comment ? '' : ' (and left no comment)'}.</span>
                    )}
                    {isEditing ? (
                      <>
                        <button className="btn btn-sm btn-primary" disabled={busyId === r.id} onClick={saveEdit}>Save</button>
                        <button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      </>
                    ) : (
                      <button className="btn btn-sm" onClick={() => setEditing({ id: r.id, display_name: r.display_name || '', project_label: r.project_label || '' })}>Edit display</button>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>
                  {r.status === 'scheduled' && <>Due {fmt(r.send_after)}{r.hold_reason ? ` — ${holdLabel(r.hold_reason)}` : ''}</>}
                  {r.status === 'sent' && <>Sent {fmt(r.sent_at)}{r.reminder_sent_at ? `, reminder ${fmt(r.reminder_sent_at)}` : ''}</>}
                  {r.status === 'skipped' && <>Not sent{r.skip_reason ? ` — ${holdLabel(r.skip_reason)}` : ''}</>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
