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

// Measures the real rendered height of each block inside the document and
// inserts an explicit page break (plus a "continued on next page" note and
// a simulated top margin) wherever content would otherwise overflow a
// letter page. Cleaned up right after capture so the on-screen preview is
// unaffected.
function paginateElement(root) {
  const PAGE_HEIGHT_PX = 979; // 11in page, 0.4in top+bottom margin, at 96dpi
  const PAGE_TOP_PADDING_PX = 50; // html2pdf slices a continuous screenshot, so a
  // page that starts mid-document gets none of page 1's natural top spacing
  // unless we add it back explicitly to whatever lands at the top of it.
  const header = root.querySelector('.doc-header');
  const body = root.querySelector('.doc-body');
  const injectedNotes = [];
  const injectedBreaks = [];
  const injectedPaddings = [];

  if (!header || !body) return { injectedNotes, injectedBreaks, injectedPaddings };

  function heightOf(el) {
    const cs = window.getComputedStyle(el);
    return el.offsetHeight + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0);
  }

  // Step 1: build a flat list of candidate break points. Most .doc-body
  // children are one block each. A section that's mostly a bulleted list
  // (Scope of Work, Assumptions & Exclusions) gets flattened into its
  // heading plus each <li> as separate entries, so the list can split
  // across a page at an item boundary instead of jumping as one indivisible
  // block and leaving a gap on the page before it.
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

  // Step 2: glue any break-after:avoid block (a heading — either the
  // "Terms & Conditions" style divider, or a section heading now that it's
  // flattened next to its own first item) to whatever immediately follows
  // it, so it can never be orphaned alone at the bottom of a page.
  const units = [];
  for (let i = 0; i < rawBlocks.length; i++) {
    const el = rawBlocks[i];
    const cs = window.getComputedStyle(el);
    const h = heightOf(el);
    const glueNext = (cs.breakAfter === 'avoid' || cs.pageBreakAfter === 'avoid') && i + 1 < rawBlocks.length;
    if (glueNext) {
      const nextEl = rawBlocks[i + 1];
      units.push({ breakTarget: el, height: h + heightOf(nextEl) });
      i++;
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

      injectedPaddings.push({ el: u.breakTarget, prevValue: u.breakTarget.style.paddingTop });
      u.breakTarget.style.paddingTop = PAGE_TOP_PADDING_PX + 'px';

      runningHeight = u.height;
    } else {
      runningHeight += u.height;
    }
  });

  return { injectedNotes, injectedBreaks, injectedPaddings };
}

function cleanupPagination({ injectedNotes, injectedBreaks, injectedPaddings }) {
  injectedNotes.forEach(n => n.remove());
  injectedBreaks.forEach(el => {
    el.style.pageBreakBefore = '';
    el.style.breakBefore = '';
  });
  injectedPaddings.forEach(({ el, prevValue }) => {
    el.style.paddingTop = prevValue;
  });
}
