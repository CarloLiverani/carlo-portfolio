/**
 * Simple Express server for the portfolio site.
 *
 * - Serves the static single-page site from /public
 * - Exposes POST /api/contact which emails form submissions to you
 *
 * Email delivery is handled by nodemailer over SMTP. Configure it with the
 * environment variables listed in README.md (any SMTP provider works:
 * Resend, Postmark, SendGrid, Mailgun, Gmail app password, ...).
 * Until SMTP is configured, submissions are logged to the console and the
 * endpoint still responds with success, so the site works out of the box.
 */

const path = require('path');
const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Email configuration (placeholder — fill in via environment variables)
// ---------------------------------------------------------------------------
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || 'you@example.com';
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'portfolio@example.com';

const smtpConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Contact endpoint
// ---------------------------------------------------------------------------
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body || {};

  const clean = (value, max) =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';

  const safeName = clean(name, 200);
  const safeEmail = clean(email, 200);
  const safeMessage = clean(message, 5000);

  if (!safeName || !safeEmail || !safeMessage) {
    return res
      .status(400)
      .json({ ok: false, error: 'Please fill in your name, email, and message.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
    return res
      .status(400)
      .json({ ok: false, error: 'That email address doesn’t look right.' });
  }

  const submission = {
    name: safeName,
    email: safeEmail,
    message: safeMessage,
    receivedAt: new Date().toISOString(),
  };

  if (!smtpConfigured) {
    // Placeholder mode: no email service configured yet. Log the submission
    // so nothing is lost during development, but report success to the user.
    console.log('[contact] SMTP not configured — submission logged instead:');
    console.log(JSON.stringify(submission, null, 2));
    return res.json({ ok: true });
  }

  try {
    await transporter.sendMail({
      from: `"Portfolio contact form" <${CONTACT_FROM_EMAIL}>`,
      to: CONTACT_TO_EMAIL,
      replyTo: safeEmail,
      subject: `New inquiry from ${safeName}`,
      text: [
        `Name: ${safeName}`,
        `Email: ${safeEmail}`,
        `Received: ${submission.receivedAt}`,
        '',
        safeMessage,
      ].join('\n'),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[contact] Failed to send email:', err);
    return res
      .status(502)
      .json({ ok: false, error: 'Something went wrong sending your message. Please email me directly.' });
  }
});

// Fallback: send the single page for any other GET (keeps deep links working)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Portfolio site running on http://localhost:${PORT}`);
  if (!smtpConfigured) {
    console.log('[contact] SMTP not configured — contact form submissions will be logged to the console.');
    console.log('[contact] Set SMTP_HOST, SMTP_USER, SMTP_PASS, CONTACT_TO_EMAIL to enable email delivery.');
  }
});
