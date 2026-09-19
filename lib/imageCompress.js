// Client-side compression for photo uploads that don't need a watermark.
// Resizes to a max dimension and re-encodes as JPEG to keep storage and
// upload time reasonable, without a visible quality hit on-screen.
import { ensureDecodableImage, looksHeic } from './heicConvert';

const MAX_DIMENSION = 1600;

export async function compressImage(file, { maxDimension = MAX_DIMENSION, quality = 0.82 } = {}) {
  // Not an image at all (PDFs etc.) — leave it alone. HEIC/HEIF can report
  // an empty file.type on some devices, so that check alone would also
  // wave through an unconverted HEIC file (unviewable in most browsers
  // later); check the filename too before bailing out.
  if ((!file.type || !file.type.startsWith('image/')) && !looksHeic(file)) return file;

  const decodable = await ensureDecodableImage(file);

  // Prefer createImageBitmap: it decodes off the main thread and never
  // materializes a full-size <img> element sitting in the DOM's decoded-
  // image cache — its memory is released the moment .close() runs below.
  // The old path (new Image() + URL.createObjectURL, never revoked) leaked
  // one full decoded image's worth of memory per photo processed, for the
  // rest of the page's life. iOS Safari has a low, hard per-page ceiling
  // for decoded image memory; blow through it mid-batch and the classic
  // response is a silent full-page reload — wiping every bit of
  // in-progress JS state (including whatever's left of a multi-photo
  // batch) with no error, since the page context that would report one
  // no longer exists. That fits a pattern of "some photos post, the rest
  // just vanish, count varies run to run" exactly — for a photo taken
  // via the in-app camera or picked from the library alike, since both
  // land here.
  let bitmap = null;
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(decodable);
    }
  } catch {
    // Some Safari versions can't createImageBitmap certain HEIC-derived
    // blobs — fall through to the <img>-based path below instead of
    // failing the whole photo over it.
    bitmap = null;
  }

  const source = bitmap || await loadImageEl(decodable);
  const sourceWidth = bitmap ? bitmap.width : source.naturalWidth || source.width;
  const sourceHeight = bitmap ? bitmap.height : source.naturalHeight || source.height;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  if (bitmap) bitmap.close(); // release decoded pixel memory now, don't wait on GC

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
  });
}

// Fallback decode path for browsers/blobs createImageBitmap can't handle.
// Unlike the version this replaced, the object URL is always revoked as
// soon as the image has decoded (success or failure) rather than leaking
// for the rest of the page's life.
function loadImageEl(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    // A plain Event, not an Error — leaving it as the rejection reason
    // surfaces as "...failed: undefined" in the UI. Wrap it so the person
    // sees an actual explanation.
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image — it may be corrupted, or in a format this browser can\'t display.'));
    };
    img.src = url;
  });
}
