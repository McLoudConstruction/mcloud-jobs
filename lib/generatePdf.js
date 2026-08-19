// Converts a base64 PDF string into a Blob URL, suitable for window.open()
// so the browser's native PDF viewer opens it in a new tab.
export function base64ToPdfUrl(base64) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}

const PAGE_HEIGHT_PX = 979; // 11in page, 0.4in top+bottom margin, at 96dpi — matches the document's own @page CSS
const PAGE_WIDTH_IN = 8.5;
const PAGE_HEIGHT_IN = 11;
const TOP_MARGIN_PX = 50; // breathing room added to the top of every page after the first

// Works out where each new page should begin, in the element's own
// coordinate space, without touching the DOM. A section that's mostly one
// long bulleted list gets flattened into its heading plus each <li>
// individually, so a break can land between two items but never inside one.
// A heading marked break-after:avoid stays glued to whatever comes right
// after it, so it can never end up alone at the bottom of a page.
function calculateBreakOffsets(root) {
  const header = root.querySelector('.doc-header');
  const body = root.querySelector('.doc-body');
  if (!header || !body) return [];

  function heightOf(el) {
    const cs = window.getComputedStyle(el);
    return el.offsetHeight + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0);
  }
  function topOf(el) {
    return el.getBoundingClientRect().top - root.getBoundingClientRect().top;
  }

  const rawBlocks = [header];
  Array.from(body.children).forEach(el => {
    const list = el.classList?.contains('section') ? el.querySelector(':scope > ul.doc-list') : null;
    if (list && list.children.length > 2) {
      const heading = el.querySelector(':scope > h3');
      if (heading) rawBlocks.push(heading);
      Array.from(list.children).forEach(li => rawBlocks.push(li));
    } else {
      rawBlocks.push(el);
    }
  });

  const units = [];
  for (let i = 0; i < rawBlocks.length; i++) {
    const el = rawBlocks[i];
    const cs = window.getComputedStyle(el);
    const h = heightOf(el);
    const glueNext = (cs.breakAfter === 'avoid' || cs.pageBreakAfter === 'avoid') && i + 1 < rawBlocks.length;
    if (glueNext) {
      units.push({ el, height: h + heightOf(rawBlocks[i + 1]) });
      i++;
    } else {
      units.push({ el, height: h });
    }
  }

  const breakOffsets = [];
  let runningHeight = 0;
  units.forEach((u, i) => {
    if (i === 0) { runningHeight = u.height; return; }
    if (runningHeight + u.height > PAGE_HEIGHT_PX) {
      breakOffsets.push(topOf(u.el));
      runningHeight = u.height;
    } else {
      runningHeight += u.height;
    }
  });

  return breakOffsets;
}

// Renders a DOM element to a PDF and returns it as a base64 string (no
// data: prefix). Captures the whole document as one image, then slices it
// into pages itself at the offsets calculated above — no library-internal
// page-break guessing involved, so there's nothing else deciding page
// boundaries that could disagree with this calculation.
export async function generatePdfBase64(elementId, filename) {
  const html2canvas = (await import('html2canvas')).default;
  const { jsPDF } = await import('jspdf');

  const element = document.getElementById(elementId);
  if (!element) throw new Error('Document not ready yet — try again in a moment.');

  const breakOffsets = calculateBreakOffsets(element);

  const scale = 2;
  const fullCanvas = await html2canvas(element, {
    scale,
    useCORS: true,
    backgroundColor: '#ffffff',
  });

  const scaledWidth = fullCanvas.width;
  const totalHeightUnscaled = element.scrollHeight;
  const cutPoints = [0, ...breakOffsets, totalHeightUnscaled];

  const pdf = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });

  for (let i = 0; i < cutPoints.length - 1; i++) {
    const startUnscaled = cutPoints[i];
    const endUnscaled = cutPoints[i + 1];
    const sliceHeightUnscaled = endUnscaled - startUnscaled;
    if (sliceHeightUnscaled <= 0) continue;

    const marginTop = i === 0 ? 0 : TOP_MARGIN_PX;

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = scaledWidth;
    sliceCanvas.height = Math.round((sliceHeightUnscaled + marginTop) * scale);
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(
      fullCanvas,
      0, Math.round(startUnscaled * scale), scaledWidth, Math.round(sliceHeightUnscaled * scale),
      0, Math.round(marginTop * scale), scaledWidth, Math.round(sliceHeightUnscaled * scale)
    );

    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.95);
    if (i > 0) pdf.addPage();
    const imgHeightIn = (sliceCanvas.height / sliceCanvas.width) * PAGE_WIDTH_IN;
    pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_WIDTH_IN, Math.min(imgHeightIn, PAGE_HEIGHT_IN));
  }

  const blob = pdf.output('blob');
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
