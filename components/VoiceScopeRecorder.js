'use client';
import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

// Records a site-walk on the estimator's phone/laptop, transcribes it
// server-side (Whisper), then drafts scope-of-work items from the transcript
// (/api/ai/transcribe, then /api/ai/draft-scope). Nothing is saved until the
// estimator reviews the drafted items — same review-before-save contract as
// AIScopeGenerator right above this in ScopeCard.
export default function VoiceScopeRecorder({ projectType, jobId, existingItems, onGenerate }) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [stage, setStage] = useState(''); // '' | 'transcribing' | 'drafting'
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && (!navigator.mediaDevices || !window.MediaRecorder)) setUnsupported(true);
  }, []);

  useEffect(() => () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  async function startRecording() {
    setError('');
    setTranscript('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => handleStopped(recorder.mimeType || 'audio/webm');
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      setError('Could not access the microphone — check your browser/device permissions.');
    }
  }

  function stopRecording() {
    clearInterval(timerRef.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    setRecording(false);
  }

  async function handleStopped(mimeType) {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    if (blob.size < 2000) { setError('That recording was too short to use.'); return; }
    setStage('transcribing');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('audio', blob, 'walkthrough.webm');
      const res = await fetch('/api/ai/transcribe', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` }, body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transcription failed.');
      setTranscript(data.transcript);
      setStage('drafting');
      const draftRes = await fetch('/api/ai/draft-scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ jobId, transcript: data.transcript, projectType, existingItems }),
      });
      const draft = await draftRes.json();
      if (!draftRes.ok) throw new Error(draft.error || 'Could not draft scope items.');
      if (!draft.items?.length) {
        setError('Nothing usable came out of that recording — try describing the work more specifically.');
      } else {
        onGenerate(draft.items);
        setOpen(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStage('');
    }
  }

  if (unsupported) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      {!open ? (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>🎙 Record a walkthrough</button>
      ) : (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
            Talk through the space like you're describing it to the customer — what's being removed, replaced, or added. Review the drafted items before saving; nothing is added automatically.
          </div>
          {!recording && !stage && (
            <button type="button" className="btn btn-primary btn-sm" onClick={startRecording}>● Start recording</button>
          )}
          {recording && (
            <button type="button" className="btn btn-primary btn-sm" onClick={stopRecording} style={{ background: '#a13f3f', borderColor: '#a13f3f' }}>
              ■ Stop ({String(Math.floor(seconds / 60)).padStart(1, '0')}:{String(seconds % 60).padStart(2, '0')})
            </button>
          )}
          {stage === 'transcribing' && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Transcribing…</div>}
          {stage === 'drafting' && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Drafting scope items…</div>}
          {error && <div style={{ fontSize: 12, color: '#a13f3f', marginTop: 8 }}>{error}</div>}
          {transcript && stage === '' && error && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--ink-soft)' }}>Show transcript</summary>
              <div style={{ fontSize: 11.5, marginTop: 6, whiteSpace: 'pre-wrap' }}>{transcript}</div>
            </details>
          )}
          <div className="section-actions">
            <button type="button" className="btn btn-sm" onClick={() => { setOpen(false); setError(''); }} disabled={recording || !!stage}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
