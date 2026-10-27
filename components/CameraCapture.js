'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import DestinationPicker from './DestinationPicker';
import { FlashOnIcon, FlashOffIcon, FlipCameraIcon } from './photoIcons';

// Full-screen in-browser camera that stays open across shots.
// Flow: live view -> snap -> review (Retake / Use Photo) -> live view, until
// the person taps DONE. Works on iPhone Safari, the home-screen app, and
// Chrome on Android.
//
// Props
//   open, onClose
//   onPhotoAccepted(file, { takenAt })   called for each accepted photo
//   destination    optional usePhotoDestination() object; shows the folder pill
//   uploadStatus   optional { pending, failed, onRetry } for the status line
//   title          optional small caption in the top bar

const MAX_DIGITAL_ZOOM = 5;
let lastStopAt = 0; // module level: lets a re-open wait for the old stream to release

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function permissionState() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const res = await navigator.permissions.query({ name: 'camera' });
    return res.state; // granted | prompt | denied
  } catch { return 'unknown'; }
}

async function openStream(facingMode) {
  const attempts = [
    { video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      // Only a constraint problem is worth trying a simpler request for.
      if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotFoundError' && err?.name !== 'TypeError') throw err;
    }
  }
  throw lastErr;
}

export default function CameraCapture({ open, onClose, onPhotoAccepted, destination, uploadStatus, title }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const fallbackInputRef = useRef(null);
  const genRef = useRef(0); // lets a slow start notice it was superseded
  const snappingRef = useRef(false);

  const [facingMode, setFacingMode] = useState('environment');
  const [reviewFile, setReviewFile] = useState(null); // { blob, previewUrl, takenAt }
  const [count, setCount] = useState(0);
  const [error, setError] = useState(null); // { kind, message }
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');

  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomRange, setZoomRange] = useState({ min: 1, max: MAX_DIGITAL_ZOOM, hardware: false });
  const zoomRef = useRef(1);
  const rangeRef = useRef(zoomRange);
  rangeRef.current = zoomRange;

  const stopStream = useCallback(() => {
    genRef.current += 1;
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
      streamRef.current = null;
      lastStopAt = Date.now();
    }
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch { /* ignore */ }
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const startStream = useCallback(async () => {
    const gen = ++genRef.current;
    setError(null);
    setStarting(true);

    // iOS needs a moment after the previous stream is stopped before the
    // camera can be opened again. Opening too soon is what made re-entering
    // the camera report "access denied" even though access was granted.
    const sinceStop = Date.now() - lastStopAt;
    if (sinceStop < 400) await sleep(400 - sinceStop);

    let stream = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3 && !stream; attempt++) {
      if (gen !== genRef.current) return; // closed or restarted meanwhile
      try {
        stream = await openStream(facingMode);
      } catch (err) {
        lastErr = err;
        const retryable = ['NotAllowedError', 'NotReadableError', 'AbortError'].includes(err?.name);
        if (!retryable) break;
        await sleep(600 * (attempt + 1));
      }
    }

    if (gen !== genRef.current) {
      // We were superseded while waiting: release whatever we got.
      stream?.getTracks().forEach(t => t.stop());
      return;
    }

    if (!stream) {
      setStarting(false);
      const name = lastErr?.name;
      if (name === 'NotAllowedError') {
        const state = await permissionState();
        if (gen !== genRef.current) return;
        if (state === 'denied') {
          setError({
            kind: 'denied',
            message: 'Camera access is turned off for this site. Turn it on in your browser or phone settings, then tap Try again.',
          });
        } else {
          setError({
            kind: 'retry',
            message: "The camera didn't start. This can happen right after leaving it. Tap Try again.",
          });
        }
      } else if (name === 'NotReadableError' || name === 'AbortError') {
        setError({ kind: 'retry', message: 'The camera is busy. Close any other app using it, then tap Try again.' });
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setError({ kind: 'none', message: 'No camera was found on this device.' });
      } else {
        setError({ kind: 'retry', message: 'Could not start the camera. Tap Try again, or choose photos from your library.' });
      }
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay handled by playsInline + muted */ }
    }
    if (gen !== genRef.current) return;

    const track = stream.getVideoTracks()[0];
    const caps = track?.getCapabilities ? track.getCapabilities() : {};
    setTorchSupported(!!caps.torch);
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const min = caps.zoom.min || 1;
      const max = Math.min(caps.zoom.max, 10);
      setZoomRange({ min, max, hardware: true });
      zoomRef.current = min;
      setZoom(min);
    } else {
      setZoomRange({ min: 1, max: MAX_DIGITAL_ZOOM, hardware: false });
      zoomRef.current = 1;
      setZoom(1);
    }
    setStarting(false);
  }, [facingMode]);

  // Start when opened, release when closed. The camera is also released when
  // the page is hidden (switching apps) and reopened when it comes back.
  useEffect(() => {
    if (!open) return undefined;
    setCount(0);
    setReviewFile(null);
    setNotice('');
    startStream();
    const onVisibility = () => {
      if (document.hidden) stopStream();
      else startStream();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Zoom ────────────────────────────────────────────────────────────────
  const applyZoom = useCallback(value => {
    const { min, max, hardware } = rangeRef.current;
    const v = Math.min(max, Math.max(min, value));
    zoomRef.current = v;
    setZoom(v);
    if (hardware) {
      const track = streamRef.current?.getVideoTracks()[0];
      track?.applyConstraints({ advanced: [{ zoom: v }] }).catch(() => {});
    }
  }, []);

  const sliderRef = useRef(null);
  function sliderToZoom(clientY) {
    const rect = sliderRef.current.getBoundingClientRect();
    const ratio = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const { min, max } = rangeRef.current;
    return min + ratio * (max - min);
  }
  function onSliderDown(e) {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    applyZoom(sliderToZoom(e.clientY));
  }
  function onSliderMove(e) {
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    applyZoom(sliderToZoom(e.clientY));
  }

  // Pinch to zoom on the picture.
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  function onViewportDown(e) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoomRef.current };
    }
  }
  function onViewportMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) applyZoom(pinch.current.zoom * (dist / pinch.current.dist));
    }
  }
  function onViewportUp(e) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  // ── Capture ─────────────────────────────────────────────────────────────
  function handleSnap() {
    if (snappingRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      setNotice("That shot didn't register. The camera wasn't ready. Try again.");
      return;
    }
    snappingRef.current = true;
    setNotice('');
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const digital = !rangeRef.current.hardware && zoomRef.current > 1.01;
    const z = digital ? zoomRef.current : 1;
    const sw = Math.round(vw / z);
    const sh = Math.round(vh / z);
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    const takenAt = Date.now();
    canvas.toBlob(
      blob => {
        snappingRef.current = false;
        if (!blob) {
          setNotice("That shot didn't come through. Try again.");
          return;
        }
        setReviewFile({ blob, previewUrl: URL.createObjectURL(blob), takenAt });
      },
      'image/jpeg',
      0.95
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
      setNotice("Couldn't switch the flashlight on this device.");
    }
  }

  function dropReview() {
    if (reviewFile?.previewUrl) URL.revokeObjectURL(reviewFile.previewUrl);
    setReviewFile(null);
  }

  function handleUsePhoto() {
    if (!reviewFile) return;
    const file = new File([reviewFile.blob], `${reviewFile.takenAt}-camera.jpg`, { type: 'image/jpeg' });
    onPhotoAccepted?.(file, { takenAt: reviewFile.takenAt });
    setCount(c => c + 1);
    dropReview();
  }

  function handleDone() {
    stopStream();
    dropReview();
    setNotice('');
    onClose?.();
  }

  function handleFallbackFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    files.forEach(f => onPhotoAccepted?.(f, { takenAt: f.lastModified || Date.now() }));
    setCount(c => c + files.length);
  }

  if (!open) return null;

  const showFlash = torchSupported && !reviewFile;
  const zoomRatio = zoomRange.max > zoomRange.min ? (zoom - zoomRange.min) / (zoomRange.max - zoomRange.min) : 0;
  const digitalScale = !zoomRange.hardware && zoom > 1 ? zoom : 1;
  const pending = uploadStatus?.pending || 0;
  const failed = uploadStatus?.failed || 0;

  return (
    <div className="camera-overlay">
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {!reviewFile && (
        <div className="camera-topbar">
          <div className="camera-count" aria-live="polite">
            {count} {count === 1 ? 'photo' : 'photos'}
          </div>
          {title && <div className="camera-title">{title}</div>}
          <div className="camera-top-actions">
            {showFlash && (
              <button
                type="button"
                className={`camera-round-btn${torchOn ? ' is-on' : ''}`}
                onClick={toggleTorch}
                aria-label={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
                aria-pressed={torchOn}
              >
                {torchOn ? <FlashOnIcon size={22} /> : <FlashOffIcon size={22} />}
              </button>
            )}
            <button
              type="button"
              className="camera-round-btn"
              onClick={() => setFacingMode(m => (m === 'environment' ? 'user' : 'environment'))}
              aria-label="Flip camera"
            >
              <FlipCameraIcon size={22} />
            </button>
          </div>
        </div>
      )}

      <div
        className="camera-viewport"
        onPointerDown={reviewFile ? undefined : onViewportDown}
        onPointerMove={reviewFile ? undefined : onViewportMove}
        onPointerUp={reviewFile ? undefined : onViewportUp}
        onPointerCancel={reviewFile ? undefined : onViewportUp}
      >
        <video
          ref={videoRef}
          className="camera-video"
          autoPlay
          playsInline
          muted
          style={{
            display: reviewFile ? 'none' : undefined,
            transform: digitalScale > 1 ? `scale(${digitalScale})` : undefined,
          }}
        />
        {starting && !error && !reviewFile && <div className="camera-status">Starting camera</div>}
        {error && !reviewFile && (
          <div className="camera-error">
            <p>{error.message}</p>
            <div className="camera-error-actions">
              {error.kind !== 'none' && (
                <button type="button" className="camera-pill-btn camera-pill-solid" onClick={startStream}>Try again</button>
              )}
              <button type="button" className="camera-pill-btn" onClick={() => fallbackInputRef.current?.click()}>
                Choose from library
              </button>
            </div>
          </div>
        )}
        {reviewFile && <img src={reviewFile.previewUrl} alt="Captured preview" className="camera-review-image" />}

        {!reviewFile && !error && (
          <div className="camera-zoom" aria-label="Zoom">
            <div className="camera-zoom-readout">{zoom.toFixed(1)}x</div>
            <div
              ref={sliderRef}
              className="camera-zoom-track"
              onPointerDown={onSliderDown}
              onPointerMove={onSliderMove}
              role="slider"
              aria-orientation="vertical"
              aria-valuemin={zoomRange.min}
              aria-valuemax={zoomRange.max}
              aria-valuenow={Number(zoom.toFixed(1))}
              tabIndex={0}
            >
              <div className="camera-zoom-fill" style={{ height: `${zoomRatio * 100}%` }} />
              <div className="camera-zoom-thumb" style={{ bottom: `calc(${zoomRatio * 100}% - 11px)` }} />
            </div>
          </div>
        )}

        {!reviewFile && (notice || pending > 0 || failed > 0) && (
          <div className="camera-notice" role="status">
            {notice ? notice : failed > 0 ? (
              <>
                {failed} {failed === 1 ? 'photo' : 'photos'} not uploaded.{' '}
                {uploadStatus?.onRetry && (
                  <button type="button" className="camera-link" onClick={uploadStatus.onRetry}>Retry</button>
                )}
              </>
            ) : `Uploading ${pending} ${pending === 1 ? 'photo' : 'photos'}`}
          </div>
        )}
      </div>

      {!reviewFile && (
        <div className="camera-controls">
          <div className="camera-controls-left">
            <DestinationPicker destination={destination} variant="camera" />
          </div>
          <button
            type="button"
            className="camera-shutter-btn"
            onClick={handleSnap}
            disabled={!!error || starting}
            aria-label="Take photo"
          />
          <div className="camera-controls-right">
            <button type="button" className="camera-done-btn" onClick={handleDone}>DONE</button>
          </div>
        </div>
      )}

      {reviewFile && (
        <div className="camera-review-controls">
          <button type="button" className="camera-review-btn camera-review-retake" onClick={dropReview}>Retake</button>
          <button type="button" className="camera-review-btn camera-review-use" onClick={handleUsePhoto}>Use Photo</button>
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
