'use client';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { useRequireAuth } from '../../lib/useAuth';
import AppShell from '../../components/AppShell';
import ManualRouteBuilderModal from '../../components/ManualRouteBuilderModal';
import MobileFab from '../../components/MobileFab';
import ScrollFadeRow from '../../components/ScrollFadeRow';
import BidWalkScheduler from '../../components/BidWalkScheduler';
import { formatPhone } from '../../lib/constants';

// Stage -> badge color, reusing the site's existing badge palette rather
// than inventing new colors just for this page's mobile cards.
const STAGE_BADGE_CLASS = {
  prospecting: 'badge-new',
  contacted: 'badge-proposal_delivered',
  lost: 'badge-lost',
  converted: 'badge-approved',
};

const STAGES = ['prospecting', 'contacted', 'lost', 'converted'];
const STAGE_LABELS = { prospecting: 'Prospecting', contacted: 'Contacted', lost: 'Lost', converted: 'Converted' };
const ACTIVE_STAGES = ['prospecting', 'contacted'];

const EMPTY_FORM = { project_type: '', company: '', project: '', contact_name: '', contact_email: '', contact_phone: '', anticipated_timeline: '', date_taken: new Date().toISOString().slice(0, 10), notes: '', referral_name: '' };

export default function SalesDashboardPage() {
  const { session, loading } = useRequireAuth();
  const router = useRouter();
  const [opps, setOpps] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  useEffect(() => {
    function checkSize() { setIsMobile(window.innerWidth < 900); }
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  function toggleExpanded(id) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [stageFilter, setStageFilter] = useState('all');
  const [lossReasonPromptId, setLossReasonPromptId] = useState(null);
  const [lossReasonText, setLossReasonText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [autofillNote, setAutofillNote] = useState('');
  const [saveError, setSaveError] = useState('');
  const [manualRouteModalOpen, setManualRouteModalOpen] = useState(false);
  const searchTimer = useRef(null);

  const loadOpps = useCallback(async () => {
    const { data } = await supabase.from('opportunities').select('*').order('date_taken', { ascending: false });
    if (data) setOpps(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadOpps();
    const channel = supabase.channel('opportunities').on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities' }, loadOpps).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadOpps]);

  function update(field, value) { setForm(prev => ({ ...prev, [field]: value })); }

  // ---- Contact name autofill suggestions — same idea as New Opportunity,
  // adapted for this form's single "contact name" field instead of split
  // first/last name inputs. ----
  function handleContactNameChange(value) {
    update('contact_name', value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('contacts').select('*').ilike('name', `%${value.trim()}%`).limit(5);
      setSuggestions(data || []);
      setShowSuggestions((data || []).length > 0);
    }, 250);
  }

  function applySuggestion(contact) {
    setForm(prev => ({
      ...prev,
      contact_name: contact.name || prev.contact_name,
      contact_email: contact.contact_email || prev.contact_email,
      contact_phone: contact.contact_phone || prev.contact_phone,
      company: contact.management_company || prev.company,
      project_type: contact.management_company ? 'commercial' : prev.project_type,
    }));
    setShowSuggestions(false);
    const filled = [];
    if (contact.contact_email) filled.push('email');
    if (contact.contact_phone) filled.push('phone');
    if (contact.management_company) filled.push('company');
    setAutofillNote(`Filled from ${contact.name}: ${filled.join(', ') || 'name only'}.`);
    setTimeout(() => setAutofillNote(''), 6000);
  }

  async function submit(e) {
    e.preventDefault();
    // This "needs a company or project name" guard exists to stop a blank
    // New Lead from being created — it should never block saving an EDIT.
    // A residential lead identified only by contact name (no company, no
    // project name entered) already exists as a row; requiring Company or
    // Project here made every edit to that lead silently no-op on Save,
    // with no error shown, since the form just returned before touching
    // Supabase at all.
    if (!editingId && !form.company.trim() && !form.project.trim() && !form.contact_name.trim()) return;
    setSaving(true);
    setSaveError('');
    let mutationError;
    if (editingId) {
      ({ error: mutationError } = await supabase.from('opportunities').update(form).eq('id', editingId));
    } else {
      ({ error: mutationError } = await supabase.from('opportunities').insert({ ...form, stage: 'prospecting' }));

      if (!mutationError && (form.contact_email.trim() || form.contact_name.trim())) {
        const { data: existing } = form.contact_email.trim()
          ? await supabase.from('contacts').select('id').eq('contact_email', form.contact_email.trim()).maybeSingle()
          : { data: null };
        if (!existing) {
          const [first, ...rest] = form.contact_name.trim().split(' ');
          await supabase.from('contacts').insert({
            name: form.contact_name.trim() || form.company.trim() || 'Unnamed',
            first_name: first || null,
            last_name: rest.join(' ') || null,
            contact_email: form.contact_email.trim() || null,
            contact_phone: form.contact_phone.trim() || null,
            management_company: form.project_type === 'commercial' ? form.company.trim() || null : null,
            contact_type: form.project_type === 'commercial' ? 'Commercial' : 'Residential - Homeowner',
          });
        }
      }
    }
    setSaving(false);
    if (mutationError) {
      setSaveError(mutationError.message);
      return;
    }
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    // Don't rely solely on the realtime subscription — refresh directly
    // so the change shows up immediately.
    await loadOpps();
  }

  function startEdit(o) {
    setForm({ ...EMPTY_FORM, ...o });
    setEditingId(o.id);
    setShowForm(true);
    // The page content now scrolls inside .shell-content (not the window
    // itself — see the app shell's flex-column layout), so this has to
    // target that element instead of window.scrollTo, which would only
    // affect the ancestor viewport.
    document.querySelector('.shell-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function setStage(id, stage) {
    if (stage === 'lost') {
      setLossReasonPromptId(id);
      setLossReasonText('');
      return;
    }
    const { error } = await supabase.from('opportunities').update({ stage }).eq('id', id);
    if (error) { setSaveError(error.message); return; }
    await loadOpps();
  }

  function convertToJob(id) {
    window.location.href = `/jobs/new?opp=${id}`;
  }

  // Which opportunity's bid walk is currently being scheduled — drives the
  // BidWalkScheduler popup below. The date/time itself is no longer kept
  // as per-row draft state (there's nothing to draft once picking one
  // opens a dedicated picker instead of an inline field).
  const [schedulingId, setSchedulingId] = useState(null);

  // Scheduling a bid walk/inspection is treated as the qualifying moment
  // for a lead — as soon as a date is set, this walks straight into the
  // same "Convert to Opportunity" flow the manual button uses, instead
  // of leaving conversion as a separate step someone has to remember
  // to do later. `value` is a "YYYY-MM-DDTHH:mm" local-time string, the
  // same shape BidWalkScheduler and the old datetime-local input both
  // produce.
  async function scheduleBidWalk(id, value) {
    if (!value) return;
    const { error } = await supabase.from('opportunities').update({ bid_walk_scheduled_at: new Date(value).toISOString() }).eq('id', id);
    if (error) { setSaveError(error.message); return; }
    convertToJob(id);
  }

  async function confirmLoss() {
    const { error } = await supabase.from('opportunities').update({ stage: 'lost', loss_reason: lossReasonText }).eq('id', lossReasonPromptId);
    if (error) { setSaveError(error.message); return; }
    setLossReasonPromptId(null);
    setLossReasonText('');
    await loadOpps();
  }

  async function removeOpp(id) {
    if (!confirm('Delete this opportunity?')) return;
    const { error } = await supabase.from('opportunities').delete().eq('id', id);
    if (error) { setSaveError(error.message); return; }
    await loadOpps();
  }

  const stats = useMemo(() => {
    const byStage = {};
    STAGES.forEach(s => { byStage[s] = opps.filter(o => o.stage === s).length; });
    return byStage;
  }, [opps]);

  const filtered = stageFilter === 'all' ? opps : opps.filter(o => o.stage === stageFilter);

  if (loading || !session) return null;

  return (
    <AppShell>
      <div className="container">
        <div className="top-actions">
          <h2 style={{ margin: 0, color: 'var(--heading)' }}>Sales</h2>
          {!isMobile && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn" onClick={() => setManualRouteModalOpen(true)}>Create Sales Route</button>
              <button className="btn" onClick={() => { setShowForm(s => !s); setEditingId(null); setForm(EMPTY_FORM); }}>
                {showForm ? 'Cancel' : '+ New Lead'}
              </button>
              <Link href="/jobs/new" className="btn btn-primary">+ New Opportunity</Link>
            </div>
          )}
        </div>
        {!isMobile && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: -10, marginBottom: 16 }}>
            "New Lead" tracks an early-stage prospect below — convert it to a real opportunity once it's worth pricing out. "New Opportunity" skips the pipeline and starts pricing a project directly.
          </div>
        )}

        {isMobile && (
          <MobileFab
            label="Add"
            items={[
              { label: '+ New Lead', onClick: () => { setShowForm(s => !s); setEditingId(null); setForm(EMPTY_FORM); } },
              { label: '+ New Opportunity', primary: true, onClick: () => router.push('/jobs/new') },
              { label: 'Create Sales Route', onClick: () => setManualRouteModalOpen(true) },
            ]}
          />
        )}

        <div className="card" style={isMobile ? { padding: '16px 14px' } : undefined}>
          <h3>Pipeline overview</h3>
          {isMobile ? (
            // Only 4 stages — a compact 4-column grid fits all of them on
            // screen at once, rather than a horizontal scroll strip that
            // clips the last one (the exact "hint at more, don't make it
            // obvious you can swipe" problem this redesign is fixing
            // elsewhere; here the real fix is just not needing to scroll).
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {STAGES.map(s => (
                <div key={s} style={{ textAlign: 'center', padding: '4px 2px' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--heading)', lineHeight: 1.1 }}>{stats[s] || 0}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--ink-soft)', marginTop: 3, lineHeight: 1.25 }}>{STAGE_LABELS[s]}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="two-col">
              {STAGES.map(s => (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
                  <span>{STAGE_LABELS[s]}</span>
                  <span style={{ fontWeight: 700 }}>{stats[s] || 0}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {showForm && (
          <form className="card" onSubmit={submit}>
            <h3>{editingId ? 'Edit lead' : 'New lead'}</h3>
            <div className="two-col">
              <div>
                <label>Project type</label>
                <select value={form.project_type} onChange={e => update('project_type', e.target.value)}>
                  <option value="">Select…</option>
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                </select>
              </div>
              {form.project_type === 'commercial' && (
                <div><label>Company</label><input value={form.company} onChange={e => update('company', e.target.value)} /></div>
              )}
              <div><label>Project</label><input value={form.project} onChange={e => update('project', e.target.value)} /></div>
              <div style={{ position: 'relative' }}>
                <label>Contact name</label>
                <input
                  value={form.contact_name}
                  onChange={e => handleContactNameChange(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  autoComplete="off"
                />
                {showSuggestions && (
                  <div style={{ position: 'absolute', top: '100%', zIndex: 10, background: 'var(--card-bg)', border: '1px solid var(--panel-line)', borderRadius: 5, width: '100%', marginTop: 2 }}>
                    {suggestions.map(s => (
                      <div
                        key={s.id}
                        onMouseDown={() => applySuggestion(s)}
                        style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
                      >
                        <b>{s.name}</b>{s.management_company ? ` — ${s.management_company}` : ''}
                        <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                          {[s.contact_email, s.contact_phone ? formatPhone(s.contact_phone) : null].filter(Boolean).join(' · ') || 'Click to autofill'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div><label>Contact email</label><input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} /></div>
              <div><label>Contact phone</label><input value={form.contact_phone} onChange={e => update('contact_phone', formatPhone(e.target.value))} /></div>
              <div><label>Anticipated timeline</label><input value={form.anticipated_timeline} onChange={e => update('anticipated_timeline', e.target.value)} placeholder="e.g. Q1 2027" /></div>
              <div><label>Referral name</label><input value={form.referral_name} onChange={e => update('referral_name', e.target.value)} placeholder="Who referred this lead to us?" /></div>
              <div>
                <label>Date entered</label>
                <input value={new Date(form.date_taken + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} disabled style={{ opacity: 0.7 }} />
              </div>
            </div>
            {autofillNote && <div style={{ fontSize: 11.5, color: '#3a6b45', marginTop: 6 }}>{autofillNote}</div>}
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => update('notes', e.target.value)} />
            {saveError && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 6 }}>{saveError}</div>}
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Save changes' : 'Create lead')}</button>
            </div>
          </form>
        )}

        {lossReasonPromptId && (
          <div className="card">
            <h3>Reason for loss</h3>
            <textarea value={lossReasonText} onChange={e => setLossReasonText(e.target.value)} placeholder="e.g. Went with another contractor, budget cut, timeline no longer fits…" />
            <div className="section-actions">
              <button className="btn btn-primary btn-sm" onClick={confirmLoss}>Save &amp; mark lost</button>
              <button className="btn btn-sm" onClick={() => setLossReasonPromptId(null)}>Cancel</button>
            </div>
          </div>
        )}

        <ScrollFadeRow trackClassName="stage-tabs">
          <button className={`stage-tab ${stageFilter === 'all' ? 'active' : ''}`} onClick={() => setStageFilter('all')}>All ({opps.length})</button>
          {STAGES.map(s => (
            <button key={s} className={`stage-tab ${stageFilter === s ? 'active' : ''}`} onClick={() => setStageFilter(s)}>
              {STAGE_LABELS[s]} ({stats[s] || 0})
            </button>
          ))}
        </ScrollFadeRow>

        {filtered.length === 0 && <div className="empty-state">No opportunities here yet.</div>}

        {isMobile && filtered.length > 0 && (
          <div className="opp-mobile-list">
            {filtered.map(o => {
              const expanded = expandedIds.has(o.id);
              const badgeClass = STAGE_BADGE_CLASS[o.stage] || 'badge-new';
              const badgeLabel = o.stage === 'converted' ? 'Converted' : STAGE_LABELS[o.stage];
              return (
                <div className="opp-card" key={o.id}>
                  <button type="button" className="opp-card-head" onClick={() => toggleExpanded(o.id)}>
                    <span className="opp-card-text">
                      <span className="opp-card-title">{o.company || o.contact_name || 'Unnamed'}{o.project ? ` — ${o.project}` : ''}</span>
                      <span className="opp-card-sub">{o.contact_name}{o.anticipated_timeline ? ` · ${o.anticipated_timeline}` : ''}</span>
                    </span>
                    <span className={`badge ${badgeClass}`} style={{ flexShrink: 0 }}>{badgeLabel}</span>
                    <span className={`opp-card-chevron ${expanded ? 'open' : ''}`} aria-hidden="true">›</span>
                  </button>

                  {/* Convert to Opportunity (and View Job, for a converted
                      lead) only appear once the card is expanded — a
                      collapsed row is just the header, so these primary
                      actions can't be tapped by accident while scanning
                      the list. */}
                  {expanded && (
                    <div className="opp-card-details">
                      {o.stage === 'lost' && o.loss_reason && (
                        <div className="opp-card-detail-line">Loss reason: {o.loss_reason}</div>
                      )}
                      {o.bid_walk_scheduled_at && (
                        <div className="opp-card-detail-line">
                          Bid walk scheduled: {new Date(o.bid_walk_scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </div>
                      )}

                      {o.stage === 'converted' ? (
                        o.job_id && <Link href={`/jobs/${o.job_id}`} className="btn btn-sm">View Job →</Link>
                      ) : (
                        <>
                          <select value={o.stage} onChange={e => setStage(o.id, e.target.value)}>
                            {['prospecting', 'contacted', 'lost'].map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                          </select>
                          {ACTIVE_STAGES.includes(o.stage) && (
                            <button className="btn btn-primary btn-sm" onClick={() => convertToJob(o.id)}>Convert to Opportunity</button>
                          )}
                          {ACTIVE_STAGES.includes(o.stage) && !o.bid_walk_scheduled_at && (
                            <button className="btn btn-sm" onClick={() => setSchedulingId(o.id)}>
                              Schedule Bid Walk
                            </button>
                          )}
                        </>
                      )}

                      <div className="opp-card-detail-actions">
                        <button className="btn btn-sm" onClick={() => startEdit(o)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => removeOpp(o.id)}>Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isMobile && filtered.map(o => (
          <div className="job-row" key={o.id} style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="job-main">
              <span className="job-customer">{o.company || o.contact_name || 'Unnamed'} {o.project ? `— ${o.project}` : ''}</span>
              <span className="job-address">{o.contact_name}{o.anticipated_timeline ? ` · ${o.anticipated_timeline}` : ''}</span>
              {o.stage === 'lost' && o.loss_reason && <span className="job-address" style={{ color: '#a13f3f' }}>Loss reason: {o.loss_reason}</span>}
              {o.bid_walk_scheduled_at && (
                <span className="job-address">Bid walk scheduled: {new Date(o.bid_walk_scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {o.stage === 'converted' ? (
                <>
                  <span className="badge badge-approved">Converted</span>
                  {o.job_id && <Link href={`/jobs/${o.job_id}`} className="btn btn-sm">View Job →</Link>}
                </>
              ) : (
                <>
                  <select value={o.stage} onChange={e => setStage(o.id, e.target.value)} style={{ width: 'auto' }}>
                    {['prospecting', 'contacted', 'lost'].map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </select>
                  {ACTIVE_STAGES.includes(o.stage) && (
                    <button className="btn btn-primary btn-sm" onClick={() => convertToJob(o.id)}>Convert to Opportunity</button>
                  )}
                  {ACTIVE_STAGES.includes(o.stage) && !o.bid_walk_scheduled_at && (
                    <button className="btn btn-sm" onClick={() => setSchedulingId(o.id)}>
                      Schedule Bid Walk
                    </button>
                  )}
                </>
              )}
              <button className="btn btn-sm" onClick={() => startEdit(o)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => removeOpp(o.id)}>Delete</button>
            </div>
          </div>
        ))}

        <style jsx>{`
          .opp-mobile-list{ display: flex; flex-direction: column; }
          .opp-card{ border-bottom: 1px solid var(--line); }
          .opp-card:last-child{ border-bottom: none; }
          .opp-card-head{
            display: flex; align-items: center; gap: 10px; width: 100%;
            padding: 14px 4px; border: none; background: transparent;
            text-align: left; cursor: pointer; font-family: inherit;
          }
          .opp-card-head:active{ background: var(--panel); }
          .opp-card-text{ display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
          .opp-card-title{ font-size: 14.5px; font-weight: 600; color: var(--heading); overflow-wrap: break-word; }
          .opp-card-sub{ font-size: 12.5px; color: var(--ink-soft); overflow-wrap: break-word; }
          .opp-card-chevron{ flex-shrink: 0; font-size: 18px; color: var(--ink-soft); transition: transform 0.15s; }
          .opp-card-chevron.open{ transform: rotate(90deg); }
          .opp-card-primary{ padding: 0 4px 14px; }
          .opp-card-details{ padding: 0 4px 16px; display: flex; flex-direction: column; gap: 10px; }
          .opp-card-detail-line{ font-size: 12.5px; color: var(--ink-soft); }
          .opp-card-detail-actions{ display: flex; gap: 8px; flex-wrap: wrap; }
        `}</style>
      </div>
      <ManualRouteBuilderModal open={manualRouteModalOpen} onClose={() => setManualRouteModalOpen(false)} />
      <BidWalkScheduler
        open={!!schedulingId}
        onCancel={() => setSchedulingId(null)}
        onConfirm={value => { const id = schedulingId; setSchedulingId(null); scheduleBidWalk(id, value); }}
      />
    </AppShell>
  );
}
