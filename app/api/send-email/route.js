import nodemailer from 'nodemailer';

export async function POST(request) {
  try {
    const { to, subject, html, text, attachmentBase64, attachmentFilename } = await request.json();

    if (!to || !to.trim()) {
      return Response.json({ error: 'No recipient email is on file for this job yet.' }, { status: 400 });
    }
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      return Response.json({ error: 'SMTP is not configured yet — add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in Vercel.' }, { status: 500 });
    }

    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    const attachments = attachmentBase64
      ? [{ filename: attachmentFilename || 'document.pdf', content: attachmentBase64, encoding: 'base64' }]
      : undefined;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
      attachments,
    });

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message || 'Failed to send email.' }, { status: 500 });
  }
}
