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

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
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
    startStream();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode]);

  if (!open) return null;

  function handleSnap() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      blob => {
        if (!blob) return;
        setReviewFile({ blob, previewUrl: URL.createObjectURL(blob) });
      },
      'image/jpeg',
      0.9
    );
  }

  function handleRetake() {
    if (reviewFile?.previewUrl) URL.revokeObjectURL(reviewFile.previewUrl);
    setReviewFile(null);
  }

  function handleUsePhoto() {
    const file = new File([reviewFile.blob], `${Date.now()}-camera.jpg`, { type: 'image/jpeg' });
    onPhotoAccepted(file);
    setCount(c => c + 1);
    if (reviewFile?.previewUrl) URL.revokeObjectURL(reviewFile.previewUrl);
    setReviewFile(null);
    // Straight back to the live view — no need to reopen the camera.
  }

  function handleClose() {
    stopStream();
    if (reviewFile?.previewUrl) URL.revokeObjectURL(reviewFile.previewUrl);
    setReviewFile(null);
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

      {!reviewFile && (
        <>
          <div className="camera-topbar">
            <button className="camera-icon-btn" onClick={handleClose} type="button" aria-label="Close camera">✕</button>
            {title && <span className="camera-title">{title}</span>}
            {count > 0 && <span className="camera-count-badge">{count} added</span>}
          </div>

          <div className="camera-viewport">
            <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
            {starting && !error && <div className="camera-status">Starting camera…</div>}
            {error && (
              <div className="camera-error">
                <p>{error}</p>
                <button className="btn btn-primary btn-sm" onClick={() => fallbackInputRef.current?.click()} type="button">
                  Choose from library
                </button>
              </div>
            )}
          </div>

          <div className="camera-controls">
            <button className="camera-flip-btn" onClick={() => setFacingMode(m => (m === 'environment' ? 'user' : 'environment'))} type="button" aria-label="Flip camera">⟳</button>
            <button className="camera-shutter-btn" onClick={handleSnap} disabled={!!error || starting} type="button" aria-label="Take photo" />
            <span style={{ width: 44 }} />
          </div>
        </>
      )}

      {reviewFile && (
        <>
          <div className="camera-viewport">
            <img src={reviewFile.previewUrl} alt="Captured preview" className="camera-review-image" />
          </div>
          <div className="camera-review-controls">
            <button className="btn btn-sm" onClick={handleRetake} type="button">Retake</button>
            <button className="btn btn-primary btn-sm" onClick={handleUsePhoto} type="button">Use Photo</button>
          </div>
        </>
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
