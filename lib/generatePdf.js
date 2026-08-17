// Renders a DOM element to a PDF and returns it as a base64 string (no data: prefix),
// suitable for attaching to an email via the send-email API route.
export async function generatePdfBase64(elementId, filename) {
  const html2pdf = (await import('html2pdf.js')).default;
  const element = document.getElementById(elementId);
  if (!element) throw new Error('Document not ready yet — try again in a moment.');

  const opt = {
    margin: 0,
    filename: filename || 'document.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] },
  };

  const blob = await html2pdf().set(opt).from(element).outputPdf('blob');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
