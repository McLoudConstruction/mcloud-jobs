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
  const img = await loadImage(URL.createObjectURL(decodable));
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', quality);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // A plain Event, not an Error — leaving it as the rejection reason
    // surfaces as "...failed: undefined" in the UI. Wrap it so the person
    // sees an actual explanation.
    img.onerror = () => reject(new Error('Could not read this image — it may be corrupted, or in a format this browser can\'t display.'));
    img.src = src;
  });
}
