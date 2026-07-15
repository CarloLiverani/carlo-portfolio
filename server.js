/**
 * Simple Express server for the portfolio site.
 *
 * - Serves the static single-page site from /public
 * - Exposes POST /api/contact which emails form submissions to you
 *
 * Email delivery uses Resend's HTTPS API (https://resend.com), which works on
 * hosts like Railway that block traditional outbound SMTP ports. Configure it
 * with the environment variables listed in README.md.
 * Until RESEND_API_KEY is set, submissions are logged to the console and the
 * endpoint still responds with success, so the site works out of the box.
 */

const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Email configuration (via environment variables — set these on Railway)
// ---------------------------------------------------------------------------
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || 'contact@carlobuilds.com';
// Must be an address Resend lets you send from. `onboarding@resend.dev` works
// out of the box; switch to an address on your own verified domain later.
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'onboarding@resend.dev';

const emailConfigured = Boolean(RESEND_API_KEY);

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

  if (!emailConfigured) {
    // Placeholder mode: no email service configured yet. Log the submission
    // so nothing is lost during development, but report success to the user.
    console.log('[contact] RESEND_API_KEY not set — submission logged instead:');
    console.log(JSON.stringify(submission, null, 2));
    return res.json({ ok: true });
  }

  // Give up after 15s rather than hanging the request forever.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        from: `Portfolio contact form <${CONTACT_FROM_EMAIL}>`,
        to: [CONTACT_TO_EMAIL],
        reply_to: safeEmail,
        subject: `New inquiry from ${safeName}`,
        text: [
          `Name: ${safeName}`,
          `Email: ${safeEmail}`,
          `Received: ${submission.receivedAt}`,
          '',
          safeMessage,
        ].join('\n'),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[contact] Resend API returned ${response.status}: ${detail}`);
      return res
        .status(502)
        .json({ ok: false, error: 'Something went wrong sending your message. Please email me directly.' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[contact] Failed to send email:', err);
    return res
      .status(502)
      .json({ ok: false, error: 'Something went wrong sending your message. Please email me directly.' });
  } finally {
    clearTimeout(timeout);
  }
});

// Fallback: send the single page for any other GET (keeps deep links working)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Portfolio site running on http://localhost:${PORT}`);
  if (!emailConfigured) {
    console.log('[contact] RESEND_API_KEY not set — contact form submissions will be logged to the console.');
    console.log('[contact] Set RESEND_API_KEY (and optionally CONTACT_TO_EMAIL / CONTACT_FROM_EMAIL) to enable email delivery.');
  }
});
