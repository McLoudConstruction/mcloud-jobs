// Draws a logo watermark onto a photo File and returns a watermarked,
// size-compressed Blob. Runs entirely client-side — the original
// unwatermarked bytes are never uploaded.
const MAX_DIMENSION = 1920; // caps storage/bandwidth without visibly hurting quality on-screen

export async function watermarkImage(file, logoUrl) {
  const img = await loadImage(URL.createObjectURL(file));
  const { width, height } = fitWithinMax(img.width, img.height, MAX_DIMENSION);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  if (logoUrl) {
    try {
      const logo = await loadImage(logoUrl, true);
      // Size the watermark to ~18% of the photo's width, bottom-right corner, with a margin.
      const logoWidth = canvas.width * 0.25;
      const logoHeight = logoWidth * (logo.height / logo.width);
      const margin = canvas.width * 0.02;
      const x = canvas.width - logoWidth - margin;
      const y = canvas.height - logoHeight - margin;

      ctx.globalAlpha = 0.85;
      ctx.drawImage(logo, x, y, logoWidth, logoHeight);
      ctx.globalAlpha = 1;
    } catch {
      // If the logo can't be loaded (e.g. CORS), fall back to a text watermark.
      drawTextWatermark(ctx, canvas);
    }
  } else {
    drawTextWatermark(ctx, canvas);
  }

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.82);
  });
}

function fitWithinMax(width, height, maxDim) {
  if (width <= maxDim && height <= maxDim) return { width, height };
  const scale = maxDim / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function drawTextWatermark(ctx, canvas) {
  const fontSize = Math.max(16, canvas.width * 0.03);
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = fontSize * 0.08;
  ctx.textAlign = 'right';
  const text = 'McLoud Construction';
  const x = canvas.width - canvas.width * 0.03;
  const y = canvas.height - canvas.height * 0.03;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function loadImage(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
