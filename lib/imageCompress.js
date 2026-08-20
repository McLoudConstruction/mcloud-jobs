// Client-side compression for photo uploads that don't need a watermark.
// Resizes to a max dimension and re-encodes as JPEG to keep storage and
// upload time reasonable, without a visible quality hit on-screen.
const MAX_DIMENSION = 1600;

export async function compressImage(file, { maxDimension = MAX_DIMENSION, quality = 0.82 } = {}) {
  if (!file.type || !file.type.startsWith('image/')) return file; // leave PDFs etc. untouched

  const img = await loadImage(URL.createObjectURL(file));
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
    img.onerror = reject;
    img.src = src;
  });
}
