'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { STAGE_LABELS } from '../lib/constants';
import MapLinkMenu from './MapLinkMenu';

// The job page's navigation tree. On a computer it is the left sidebar; on a
// phone the same tree opens inside the Sections sheet.
//
// It reads the page's own TABS list, so a section added to TABS shows up here
// with no second list to keep in step:
//   - Overview and the four stages are groups you can fold open and shut.
//     The group you are in stays open, and the stage the job is in carries a
//     "Current" mark. Nothing is hidden, because plans change mid-project.
//   - Tabs that matter at every stage (Schedule, Photos, Documents, Messages)
//     sit below a divider as plain links. A tab with sections of its own
//     (Messages) lists them as separate links, so Email is one tap away.
export default function JobSidebar({ job, tabs, tab, section, currentStageTab, onSelect, variant = 'sidebar' }) {
  const [open, setOpen] = useState(() => new Set([tab]));

  // Moving to a group (by a link, a quick action, anything) opens it.
  useEffect(() => {
    setOpen(prev => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);

  function toggle(key) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const grouped = tabs.filter(t => t.group !== 'always');
  const always = tabs.filter(t => t.group === 'always');

  return (
    <nav className={`job-nav job-nav-${variant}`} aria-label="Project sections">
      <div className="job-nav-head" {...(variant === 'sheet' ? { 'data-sheet-drag': '' } : {})}>
        {variant === 'sidebar' && (
          <Link href="/jobs" className="job-nav-back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
            All projects
          </Link>
        )}
        <div className="job-nav-customer">{job.customer_name || 'Unnamed customer'}</div>
        <div className="job-nav-number">{job.project_number ? `#${job.project_number}` : 'No project number'}</div>
        {job.project_address && (
          <div className="job-nav-address">
            <MapLinkMenu address={job.project_address} style={{ color: 'inherit', textDecoration: 'none', textAlign: 'left', display: 'block' }}>
              {job.project_address}
            </MapLinkMenu>
          </div>
        )}
        <span className={`badge badge-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
      </div>

      {grouped.map(t => {
        const isOpen = open.has(t.key);
        const isCurrent = t.group === 'stage' && t.key === currentStageTab;
        return (
          <div key={t.key} className="job-nav-group">
            <button
              type="button"
              className={`job-nav-group-btn ${tab === t.key ? 'in-tab' : ''}`}
              aria-expanded={isOpen}
              onClick={() => toggle(t.key)}
            >
              <svg className={`job-nav-chevron ${isOpen ? 'open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span>{t.label}</span>
              {isCurrent && <span className="job-nav-current" title={`This job is in ${STAGE_LABELS[job.stage]}`}>Current</span>}
            </button>
            {isOpen && (t.sections || []).map(s => (
              <button
                key={s.key}
                type="button"
                className={`job-nav-link ${tab === t.key && section === s.key ? 'active' : ''}`}
                aria-current={tab === t.key && section === s.key ? 'page' : undefined}
                onClick={() => onSelect(t.key, s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        );
      })}

      <div className="job-nav-divider" aria-hidden="true" />

      <div className={variant === 'sheet' ? 'job-nav-always job-nav-always-grid' : 'job-nav-always'}>
        {always.flatMap(t => {
          if (!t.sections) {
            const on = tab === t.key;
            return [(
              <button key={t.key} type="button" className={`job-nav-top ${on ? 'active' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => onSelect(t.key)}>
                {t.label}
              </button>
            )];
          }
          // A tab with its own sections: each one becomes a plain link. The
          // first keeps the tab's name (Messages), the rest use their own (Email).
          return t.sections.map((s, i) => {
            const on = tab === t.key && section === s.key;
            return (
              <button key={`${t.key}-${s.key}`} type="button" className={`job-nav-top ${on ? 'active' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => onSelect(t.key, s.key)}>
                {i === 0 ? t.label : s.label}
              </button>
            );
          });
        })}
      </div>
    </nav>
  );
}
