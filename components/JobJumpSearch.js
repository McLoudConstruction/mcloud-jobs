'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { STAGE_LABELS } from '../lib/constants';

// "Jump to job" box in the top bar. Type a project number, customer name or
// street and go straight to that job. Press "/" anywhere (outside a text
// field) to focus it. Results come from the jobs table the same way the
// Projects page reads it, so staff only ever see what they could already open.
export default function JobJumpSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const seqRef = useRef(0);

  // "/" focuses the box, unless you are already typing somewhere.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    // Characters that mean something inside a PostgREST filter string.
    const term = q.replace(/[%,()*\\:"']/g, ' ').replace(/\s+/g, ' ').trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, project_number, customer_name, project_address, stage')
        .or(`project_number.ilike.%${term}%,customer_name.ilike.%${term}%,project_address.ilike.%${term}%`)
        .order('created_at', { ascending: false })
        .limit(8);
      if (seq !== seqRef.current) return;
      setResults(data || []);
      setActive(0);
      setSearching(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  function go(job) {
    setOpen(false);
    setQ('');
    setResults([]);
    inputRef.current?.blur();
    router.push(`/jobs/${job.id}`);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active]);
    }
  }

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={wrapRef} className="jump-search">
      <label className="jump-search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Jump to job"
          aria-label="Jump to a job by number, customer or address"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="jump-search-hint" aria-hidden="true">/</span>
      </label>
      {showPanel && (
        <div className="jump-search-panel" role="listbox">
          {results.map((j, i) => (
            <button
              key={j.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`jump-search-row ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(j)}
            >
              <span className="jump-search-main">
                <b>{j.project_number ? `#${j.project_number}` : 'No number'}</b> {j.customer_name || 'Unnamed customer'}
              </span>
              <span className="jump-search-sub">
                {j.project_address || 'No address'}{j.stage && STAGE_LABELS[j.stage] ? ` · ${STAGE_LABELS[j.stage]}` : ''}
              </span>
            </button>
          ))}
          {!results.length && (
            <div className="jump-search-empty">{searching ? 'Searching…' : 'No matching jobs.'}</div>
          )}
        </div>
      )}
    </div>
  );
}
