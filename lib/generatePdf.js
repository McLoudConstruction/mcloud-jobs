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

// Renders a DOM element to a PDF and returns it as a base64 string (no data: prefix),
// suitable for attaching to an email via the send-email API route.
export async function generatePdfBase64(elementId, filename) {
  const html2pdf = (await import('html2pdf.js')).default;
  const element = document.getElementById(elementId);
  if (!element) throw new Error('Document not ready yet — try again in a moment.');

  const injected = paginateElement(element);

  const opt = {
    margin: 0,
    filename: filename || 'document.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    // 'css' mode respects the explicit break-before markers we just inserted,
    // instead of html2pdf guessing where to slice — that guessing is what was
    // causing a dense page 1 followed by big empty gaps on later pages.
    pagebreak: { mode: ['css'] },
  };

  try {
    const blob = await html2pdf().set(opt).from(element).outputPdf('blob');
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } finally {
    cleanupPagination(injected);
  }
}

// Measures the real rendered height of each top-level block inside the
// document and inserts an explicit page break (plus a "continued on next
// page" note) wherever content would otherwise overflow a letter page.
// Cleaned up again right after capture so the on-screen preview is unaffected.
function paginateElement(root) {
  const PAGE_HEIGHT_PX = 979; // 11in page, 0.4in top+bottom margin, at 96dpi
  const header = root.querySelector('.doc-header');
  const body = root.querySelector('.doc-body');
  const injectedNotes = [];
  const injectedBreaks = [];

  if (header && body) {
    const rawBlocks = [header, ...Array.from(body.children)];

    // A heading like "Terms & Conditions" is its own sibling block, separate
    // from the section that follows it. Measuring it alone lets it land at
    // the very bottom of a page with nothing underneath — an orphaned
    // heading with a big gap beneath it, and its content pushed to the next
    // page. Any block marked break-after:avoid gets glued to the next block
    // for sizing purposes, so the pair moves together.
    const units = [];
    for (let i = 0; i < rawBlocks.length; i++) {
      const el = rawBlocks[i];
      const cs = window.getComputedStyle(el);
      const h = el.offsetHeight + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0);
      const glueNext = (cs.breakAfter === 'avoid' || cs.pageBreakAfter === 'avoid') && i + 1 < rawBlocks.length;

      if (glueNext) {
        const nextEl = rawBlocks[i + 1];
        const ncs = window.getComputedStyle(nextEl);
        const nh = nextEl.offsetHeight + parseFloat(ncs.marginTop || 0) + parseFloat(ncs.marginBottom || 0);
        units.push({ breakTarget: el, height: h + nh });
        i++; // the next block is already accounted for in this glued unit
      } else {
        units.push({ breakTarget: el, height: h });
      }
    }

    let runningHeight = 0;
    units.forEach((u, i) => {
      if (i === 0) { runningHeight = u.height; return; }

      if (runningHeight + u.height > PAGE_HEIGHT_PX) {
        const note = document.createElement('div');
        note.className = 'continued-note';
        note.textContent = '— continued on next page —';
        note.style.cssText = 'font-size:11px;font-style:italic;color:#6b6350;text-align:center;padding-top:14px;margin-bottom:10px;border-top:1px dashed #ded7c0;';
        u.breakTarget.parentNode.insertBefore(note, u.breakTarget);
        injectedNotes.push(note);

        u.breakTarget.style.pageBreakBefore = 'always';
        u.breakTarget.style.breakBefore = 'page';
        injectedBreaks.push(u.breakTarget);

        runningHeight = u.height;
      } else {
        runningHeight += u.height;
      }
    });
  }

  return { injectedNotes, injectedBreaks };
}

function cleanupPagination({ injectedNotes, injectedBreaks }) {
  injectedNotes.forEach(n => n.remove());
  injectedBreaks.forEach(el => {
    el.style.pageBreakBefore = '';
    el.style.breakBefore = '';
  });
}
