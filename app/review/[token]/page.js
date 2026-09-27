'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

// Public, login-free review page. The unguessable token in the link is the
// only credential; the database functions behind it (migration 138) decide
// what it can read and write.

const CATEGORIES = [
  { key: 'communication', label: 'Communication' },
  { key: 'quality', label: 'Quality of work' },
  { key: 'schedule', label: 'Staying on schedule' },
  { key: 'value', label: 'Value' },
];

const RATING_WORDS = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' };

function Stars({ value, onChange, size = 34, label }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', gap: 2 }} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(value === n && size < 30 ? 0 : n)}
          onMouseEnter={() => setHover(n)}
          style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', fontSize: size, lineHeight: 1, color: n <= shown ? '#c99a3a' : '#d8d3bf' }}
        >★</button>
      ))}
    </div>
  );
}

const shell = { minHeight: '100vh', background: '#f6f3ea', padding: '32px 16px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' };
const panel = { width: '100%', maxWidth: 520, background: '#fff', border: '1px solid #ded7c0', borderRadius: 10, padding: '28px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };

export default function ReviewPage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const [cats, setCats] = useState({});
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.rpc('get_review_by_token', { p_token: token });
      if (err || !data?.found) { setInfo({ found: false }); return; }
      setInfo(data);
      if (data.submitted) {
        setResult({ rating: data.rating, low: data.rating <= 3, show_google: data.show_google, google_url: data.google_url, already: true });
      }
    })();
  }, [token]);

  async function submit() {
    setSaving(true);
    setError('');
    const { data, error: err } = await supabase.rpc('submit_review_by_token', {
      p_token: token, p_rating: rating, p_categories: cats, p_comment: comment, p_name: name, p_consent: consent,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setResult(data);
  }

  function openGoogle() {
    supabase.rpc('log_review_google_click', { p_token: token }).then(() => {});
  }

  if (!info) return <div style={shell}><div style={panel}>Loading…</div></div>;

  if (!info.found) {
    return (
      <div style={shell}><div style={panel}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>This link isn&rsquo;t valid</h1>
        <p style={{ fontSize: 14, color: '#4a4436', lineHeight: 1.6, margin: 0 }}>It may have expired or been replaced. If you&rsquo;d like to share feedback, just reply to our email and we&rsquo;ll take it from there.</p>
      </div></div>
    );
  }

  if (result) {
    return (
      <div style={shell}><div style={panel}>
        <h1 style={{ fontSize: 22, margin: '0 0 10px', color: '#221f16' }}>{result.already ? 'Thank you — we have your feedback' : 'Thank you!'}</h1>
        <div style={{ color: '#c99a3a', fontSize: 24, marginBottom: 12 }} aria-label={`${result.rating} stars`}>{'★'.repeat(result.rating)}<span style={{ color: '#d8d3bf' }}>{'★'.repeat(5 - result.rating)}</span></div>
        {result.low ? (
          <p style={{ fontSize: 14, color: '#4a4436', lineHeight: 1.6, margin: 0 }}>
            We&rsquo;re sorry we didn&rsquo;t fully meet your expectations. Someone from our team will reach out personally to make it right.
          </p>
        ) : (
          <p style={{ fontSize: 14, color: '#4a4436', lineHeight: 1.6, margin: 0 }}>
            Your feedback means a lot to our whole crew.
          </p>
        )}
        {result.show_google && result.google_url && (
          <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid #ece6d2' }}>
            <p style={{ fontSize: 14, color: '#4a4436', lineHeight: 1.6, margin: '0 0 14px' }}>
              If you have another minute, it would help other homeowners find us if you shared it on Google, too. Totally optional.
            </p>
            <a href={result.google_url} target="_blank" rel="noopener noreferrer" onClick={openGoogle}
              style={{ display: 'inline-block', background: '#2f4858', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', padding: '12px 22px', borderRadius: 6 }}>
              Share on Google
            </a>
          </div>
        )}
      </div></div>
    );
  }

  return (
    <div style={shell}>
      <div style={panel}>
        <h1 style={{ fontSize: 22, margin: '0 0 6px', color: '#221f16' }}>How did we do{info.first_name ? `, ${info.first_name}` : ''}?</h1>
        <p style={{ fontSize: 14, color: '#4a4436', lineHeight: 1.6, margin: '0 0 22px' }}>
          Thank you for trusting McLoud Construction with {info.project_label ? `your ${String(info.project_label).toLowerCase()} project` : 'your project'}. Your honest feedback helps us get better.
        </p>

        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9b773d', marginBottom: 6 }}>Overall experience</div>
          <Stars value={rating} onChange={setRating} label="Overall rating" />
          <div style={{ fontSize: 12.5, color: '#6b6350', minHeight: 18 }}>{rating ? RATING_WORDS[rating] : 'Tap a star'}</div>
        </div>

        <details style={{ marginBottom: 20 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#2f4858', fontWeight: 600 }}>Rate specific areas (optional)</summary>
          <div style={{ marginTop: 10 }}>
            {CATEGORIES.map(c => (
              <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                <span style={{ fontSize: 13.5, color: '#221f16' }}>{c.label}</span>
                <Stars size={24} label={c.label} value={cats[c.key] || 0} onChange={v => setCats(prev => { const n = { ...prev }; if (v) n[c.key] = v; else delete n[c.key]; return n; })} />
              </div>
            ))}
          </div>
        </details>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9b773d', marginBottom: 6 }}>Tell us more (optional)</label>
        <textarea rows={5} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} placeholder="What went well? What could we have done better?"
          style={{ width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid #c4c1a6', borderRadius: 6, fontSize: 14, fontFamily: 'inherit', marginBottom: 14 }} />

        <input placeholder="Your name (optional)" value={name} maxLength={80} onChange={e => setName(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid #c4c1a6', borderRadius: 6, fontSize: 14, marginBottom: 14 }} />

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#4a4436', lineHeight: 1.5, cursor: 'pointer', marginBottom: 18 }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ width: 'auto', marginTop: 3, flexShrink: 0 }} />
          <span>McLoud Construction may share my comments publicly (for example on its website), showing my first name and last initial.</span>
        </label>

        {error && <div style={{ fontSize: 13, color: '#a13f3f', marginBottom: 10 }}>{error}</div>}
        <button onClick={submit} disabled={!rating || saving}
          style={{ width: '100%', background: rating ? '#2f4858' : '#b9b7a3', color: '#fff', border: 'none', borderRadius: 6, padding: '13px 0', fontSize: 15, fontWeight: 700, cursor: rating ? 'pointer' : 'default' }}>
          {saving ? 'Sending…' : 'Submit feedback'}
        </button>
      </div>
    </div>
  );
}
