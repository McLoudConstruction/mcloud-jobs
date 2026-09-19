'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

// Full-screen in-browser camera: stays open across shots. Flow is
// live view -> snap -> review (retake / use photo) -> back to live view,
// repeating until the user closes it. Replaces the old approach of handing
// off to the OS camera app via <input type="file" capture>, which closed
// the app on every single photo.
export default function CameraCapture({ open, onClose, onPhotoAccepted, title }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const fallbackInputRef = useRef(null);

  const [facingMode, setFacingMode] = useState('environment');
  const [reviewFile, setReviewFile] = useState(null); // { blob, previewUrl } awaiting retake/use
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [snapNotice, setSnapNotice] = useState(''); // transient "that shot didn't register" message
  const snappingRef = useRef(false); // guards a double-tap firing two snaps before the first resolves

  // Flashlight (torch) and zoom, driven by the active video track's own
  // capabilities — support is spotty (mainly Chrome/Android rear camera;
  // desktop and most front cameras report neither), so both controls only
  // render once the current stream actually says it supports them.
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoomCaps, setZoomCaps] = useState(null); // { min, max, step } or null
  const [zoomValue, setZoomValue] = useState(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
    setZoomCaps(null);
    setZoomValue(null);
  }, []);

  const startStream = useCallback(async () => {
    setError('');
    setStarting(true);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // Torch and zoom are properties of the track, not the constraints
      // above — read what this particular camera/browser combo actually
      // exposes rather than assuming either is there.
      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities ? track.getCapabilities() : {};
      setTorchSupported(!!caps.torch);
      if (caps.zoom && caps.zoom.min !== caps.zoom.max) {
        const settings = track.getSettings ? track.getSettings() : {};
        setZoomCaps({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
        setZoomValue(settings.zoom || caps.zoom.min);
      }
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera access was denied. Allow camera access in your browser settings, or choose photos from your library instead.'
          : 'Could not start the camera. You can choose photos from your library instead.'
      );
    } finally {
      setStarting(false);
    }
  }, [facingMode, stopStream]);

  useEffect(() => {
    if (!open) return;
    setCount(0);
    setReviewFile(null);
    setSnapNotice('');
    startStream();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode]);

  // Auto-clears so it doesn't sit on screen forever if the next tap
  // succeeds — but it's on screen long enough (4s) to actually be seen
  // before it goes, unlike the silent failure it replaces.
  useEffect(() => {
    if (!snapNotice) return;
    const t = setTimeout(() => setSnapNotice(''), 4000);
    return () => clearTimeout(t);
  }, [snapNotice]);

  if (!open) return null;

  // Previously this could fail two ways with zero visible sign: if the
  // video frame wasn't ready (video.videoWidth still 0 — seen on iOS
  // WebKit when the camera stream stalls under memory/resource pressure
  // during a multi-shot session) or canvas.toBlob() produced no blob, the
  // function just returned and the live view stayed put. Someone tapping
  // the shutter for shot 3 of 5 had no way to tell that tap did nothing —
  // they'd move on assuming it worked, and only find out later that
  // photos were missing with no error anywhere. Both failure paths now
  // surface a message instead of failing silently, and a ref-based guard
  // (state updates aren't synchronous, so a second tap can land before
  // React re-renders with the shutter disabled) stops a double-tap from
  // capturing two frames back to back and silently discarding the first.
  function handleSnap() {
    if (snappingRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      setSnapNotice("That shot didn't register — camera wasn't ready. Try again.");
      return;
    }
    snappingRef.current = true;
    setSnapNotice('');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      blob => {
        snappingRef.current = false;
        if (!blob) {
          setSnapNotice("That shot didn't come through. Try again.");
          return;
        }
        setReviewFile({ blob, previewUrl: URL.createObjectURL(blob) });
      },
      'image/jpeg',
      0.9
    );
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setSnapNotice("Couldn't toggle the flashlight on this device.");
    }
  }

  async function handleZoomChange(e) {
    const value = Number(e.target.value);
    setZoomValue(value);
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] });
    } catch {
      // Ignore — slider still reflects the requested value even if the
      // browser declines it mid-session.
    }
  }

  function handleRetake() {
    if (reviewFile?.previewUrl) URL.revokeObjectURL(reviewFile.previewUrl);
    setReviewFile(null);
  }

  function handleUsePhoto() {
    const file = new File([reviewFile.blob], `${Date.now()}-camera.jpg`, { type: 'image/jpeg' });
    onPhotoAccepted(file);
    setCount(c => c + 1);
    setSnapNotice('');
    if (reviewFile?.previewUrl) URL.revokeObjectURL(reviewFile.previewUrl);
    setReviewFile(null);
    // Straight back to the live view — no need to reopen the camera.
  }

  function handleClose() {
    stopStream();
    if (reviewFile?.previewUrl) URL.revokeObjectURL(reviewFile.previewUrl);
    setReviewFile(null);
    setSnapNotice('');
    onClose();
  }

  function handleFallbackFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    files.forEach(f => {
      onPhotoAccepted(f);
      setCount(c => c + 1);
    });
    handleClose();
  }

  return (
    <div className="camera-overlay">
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div className="camera-topbar" style={reviewFile ? { visibility: 'hidden' } : undefined}>
        <button className="camera-icon-btn" onClick={handleClose} type="button" aria-label="Close camera">✕</button>
        {title && <span className="camera-title">{title}</span>}
        {count > 0 && <span className="camera-count-badge">{count} added</span>}
      </div>

      <div className="camera-viewport">
        {/* Always mounted — swapping this out on every review/retake was
            what caused the black screen: a fresh <video> node has no
            srcObject, so the stream needs re-attaching, not remounting. */}
        <video ref={videoRef} className="camera-video" autoPlay playsInline muted style={reviewFile ? { display: 'none' } : undefined} />
        {starting && !error && !reviewFile && <div className="camera-status">Starting camera…</div>}
        {error && !reviewFile && (
          <div className="camera-error">
            <p>{error}</p>
            <button className="btn btn-primary btn-sm" onClick={() => fallbackInputRef.current?.click()} type="button">
              Choose from library
            </button>
          </div>
        )}
        {reviewFile && (
          <img src={reviewFile.previewUrl} alt="Captured preview" className="camera-review-image" />
        )}
        {snapNotice && !reviewFile && (
          <div
            role="status"
            style={{
              position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 13,
              padding: '8px 14px', borderRadius: 6, textAlign: 'center', maxWidth: '85%',
            }}
          >
            {snapNotice}
          </div>
        )}
      </div>

      {!reviewFile && zoomCaps && (
        <div className="camera-zoom-control" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', marginBottom: 8 }}>
          <span style={{ color: '#fff', fontSize: 12 }}>🔍</span>
          <input
            type="range"
            min={zoomCaps.min}
            max={zoomCaps.max}
            step={zoomCaps.step}
            value={zoomValue ?? zoomCaps.min}
            onChange={handleZoomChange}
            style={{ flex: 1 }}
            aria-label="Zoom"
          />
          <span style={{ color: '#fff', fontSize: 12, minWidth: 28, textAlign: 'right' }}>{Number(zoomValue ?? zoomCaps.min).toFixed(1)}x</span>
        </div>
      )}

      {!reviewFile && (
        <div className="camera-controls">
          <button className="camera-flip-btn" onClick={() => setFacingMode(m => (m === 'environment' ? 'user' : 'environment'))} type="button" aria-label="Flip camera">⟳</button>
          <button className="camera-shutter-btn" onClick={handleSnap} disabled={!!error || starting} type="button" aria-label="Take photo" />
          {torchSupported ? (
            <button
              className="camera-icon-btn"
              onClick={toggleTorch}
              type="button"
              aria-label={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
              style={{ width: 44, background: torchOn ? 'rgba(255,255,255,0.25)' : undefined }}
            >
              {torchOn ? '🔦' : '⚡'}
            </button>
          ) : (
            <span style={{ width: 44 }} />
          )}
        </div>
      )}

      {reviewFile && (
        <div className="camera-review-controls">
          <button className="btn btn-sm" onClick={handleRetake} type="button">Retake</button>
          <button className="btn btn-primary btn-sm" onClick={handleUsePhoto} type="button">Use Photo</button>
        </div>
      )}

      <input
        ref={fallbackInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFallbackFiles}
        style={{ display: 'none' }}
      />
    </div>
  );
}
