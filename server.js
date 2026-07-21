/**
 * Express server for the portfolio site.
 *
 * - Serves the static single-page site from /public (plus /book)
 * - POST /api/contact         — contact form → email via Resend
 * - GET  /api/slots           — available booking slots (next 14 days)
 * - POST /api/bookings        — create a booking (honeypot + rate limited)
 * - GET  /admin/bookings      — password-protected upcoming bookings list
 * - POST /admin/bookings/:id/cancel — cancel a booking, freeing its slot
 *
 * Configuration (environment variables):
 *   RESEND_API_KEY   — enables real email delivery (else logged to console)
 *   CONTACT_TO_EMAIL — where contact/booking notifications go
 *   DATABASE_URL     — PostgreSQL (Railway Postgres); enables booking
 *   ADMIN_PASSWORD   — enables /admin/bookings
 */

const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { pool, dbEnabled, migrate } = require('./db');
const { generateSlots, isValidSlot, formatSlotLong } = require('./slots');
const { sendEmail, emailConfigured, CONTACT_TO_EMAIL } = require('./email');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Railway terminates TLS at its proxy; trust it so req.ip is the visitor's IP.
app.set('trust proxy', 1);

app.use(express.json({ limit: '32kb' }));
// Cancel buttons submit as regular HTML forms.
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const clean = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// Rate limiting (in-memory): max 3 booking submissions per IP per hour.
// ---------------------------------------------------------------------------
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateHits = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) {
    rateHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateHits.set(ip, hits);
  return false;
}
// Keep the map from growing unboundedly.
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateHits) {
    const fresh = hits.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length === 0) rateHits.delete(ip);
    else rateHits.set(ip, fresh);
  }
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Contact endpoint
// ---------------------------------------------------------------------------
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body || {};
  const safeName = clean(name, 200);
  const safeEmail = clean(email, 200);
  const safeMessage = clean(message, 5000);

  if (!safeName || !safeEmail || !safeMessage) {
    return res.status(400).json({ ok: false, error: 'Please fill in your name, email, and message.' });
  }
  if (!EMAIL_RE.test(safeEmail)) {
    return res.status(400).json({ ok: false, error: 'That email address doesn’t look right.' });
  }

  if (!emailConfigured) {
    console.log('[contact] submission (email not configured):', JSON.stringify({ safeName, safeEmail, safeMessage }));
    return res.json({ ok: true });
  }

  const sent = await sendEmail({
    to: CONTACT_TO_EMAIL,
    replyTo: safeEmail,
    subject: `New inquiry from ${safeName}`,
    text: [`Name: ${safeName}`, `Email: ${safeEmail}`, '', safeMessage].join('\n'),
  });
  if (!sent) {
    return res.status(502).json({ ok: false, error: 'Something went wrong sending your message. Please email me directly.' });
  }
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Booking API
// ---------------------------------------------------------------------------
app.get('/api/slots', async (_req, res) => {
  if (!dbEnabled) {
    return res.status(503).json({ ok: false, error: 'Booking is temporarily unavailable. Please use the contact form instead.' });
  }
  try {
    const days = generateSlots();
    const first = days[0]?.slots[0]?.iso;
    const lastDay = days[days.length - 1];
    const last = lastDay?.slots[lastDay.slots.length - 1]?.iso;

    let booked = new Set();
    if (first && last) {
      const { rows } = await pool.query(
        `SELECT slot_start FROM bookings
         WHERE status = 'confirmed' AND slot_start BETWEEN $1 AND $2`,
        [first, last]
      );
      booked = new Set(rows.map((r) => new Date(r.slot_start).toISOString()));
    }

    const available = days
      .map((d) => ({ ...d, slots: d.slots.filter((s) => !booked.has(s.iso)) }))
      .filter((d) => d.slots.length > 0);

    res.json({ ok: true, days: available });
  } catch (err) {
    console.error('[slots] failed:', err);
    res.status(500).json({ ok: false, error: 'Could not load available times. Please try again.' });
  }
});

app.post('/api/bookings', async (req, res) => {
  if (!dbEnabled) {
    return res.status(503).json({ ok: false, error: 'Booking is temporarily unavailable. Please use the contact form instead.' });
  }

  const b = req.body || {};

  // Honeypot: real visitors never see this field. Pretend success, save nothing.
  if (clean(b.website, 200)) {
    return res.json({ ok: true });
  }

  if (rateLimited(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Too many booking attempts — please wait a bit and try again.' });
  }

  const name = clean(b.name, 200);
  const businessName = clean(b.businessName, 200);
  const email = clean(b.email, 200);
  const phone = clean(b.phone, 50);
  const message = clean(b.message, 2000);
  const slotIso = clean(b.slotStart, 40);

  if (!name || !email || !phone || !slotIso) {
    return res.status(400).json({ ok: false, error: 'Please fill in your name, email, phone, and pick a time.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'That email address doesn’t look right.' });
  }
  if (!isValidSlot(slotIso)) {
    return res.status(400).json({ ok: false, error: 'That time isn’t available — please pick a slot from the list.' });
  }

  const slotStart = new Date(slotIso);
  try {
    await pool.query(
      `INSERT INTO bookings (name, business_name, email, phone, message, slot_start, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')`,
      [name, businessName || null, email, phone, message || null, slotStart.toISOString()]
    );
  } catch (err) {
    if (err.code === '23505') {
      // Unique index hit: someone confirmed this slot first.
      return res.status(409).json({ ok: false, error: 'That slot just got taken — please pick another time.' });
    }
    console.error('[bookings] insert failed:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong saving your booking. Please try again.' });
  }

  // Emails are best-effort: the booking is already saved.
  const whenEastern = formatSlotLong(slotStart);
  sendEmail({
    to: CONTACT_TO_EMAIL,
    replyTo: email,
    subject: `New booking: ${name} — ${whenEastern}`,
    text: [
      'New consultation booking:',
      '',
      `When:     ${whenEastern}`,
      `Name:     ${name}`,
      businessName ? `Business: ${businessName}` : null,
      `Email:    ${email}`,
      `Phone:    ${phone}`,
      message ? `\nMessage:\n${message}` : null,
    ].filter(Boolean).join('\n'),
  }).catch(() => {});
  sendEmail({
    to: email,
    subject: 'Your consultation with Carlo is booked',
    text: [
      `Hi ${name},`,
      '',
      `Your free 15-minute consultation is confirmed for ${whenEastern}.`,
      '',
      'I’ll call you at the number you provided. If you need to reschedule,',
      'just reply to this email.',
      '',
      'Talk soon,',
      'Carlo Liverani',
      'carlobuilds.com',
    ].join('\n'),
  }).catch(() => {});

  return res.json({ ok: true, when: whenEastern });
});

// ---------------------------------------------------------------------------
// Admin: upcoming bookings + cancel
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).send('Admin is not configured. Set the ADMIN_PASSWORD environment variable.');
  }
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  let ok = false;
  if (scheme === 'Basic' && encoded) {
    const supplied = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    const a = crypto.createHash('sha256').update(supplied).digest();
    const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    ok = crypto.timingSafeEqual(a, b);
  }
  if (!ok) {
    res.set('WWW-Authenticate', 'Basic realm="Bookings admin", charset="UTF-8"');
    return res.status(401).send('Authentication required.');
  }
  next();
}

app.get('/admin/bookings', requireAdmin, async (_req, res) => {
  if (!dbEnabled) return res.status(503).send('Database is not configured (DATABASE_URL).');
  try {
    const { rows } = await pool.query(
      `SELECT id, name, business_name, email, phone, message, slot_start
       FROM bookings
       WHERE status = 'confirmed' AND slot_start >= now() - interval '1 hour'
       ORDER BY slot_start ASC`
    );
    const items = rows.map((r) => `
      <li class="booking">
        <div class="when">${escapeHtml(formatSlotLong(new Date(r.slot_start)))}</div>
        <div class="who">
          <strong>${escapeHtml(r.name)}</strong>${r.business_name ? ` · ${escapeHtml(r.business_name)}` : ''}<br>
          <a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a> · ${escapeHtml(r.phone)}
        </div>
        ${r.message ? `<p class="msg">${escapeHtml(r.message)}</p>` : ''}
        <form method="POST" action="/admin/bookings/${r.id}/cancel"
              onsubmit="return confirm('Cancel this booking? The slot becomes available again.');">
          <button type="submit">Cancel booking</button>
        </form>
      </li>`).join('');

    res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bookings — admin</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background:#FAF5EC; color:#29241D; margin:0; padding:1.5rem; line-height:1.5; }
  h1 { font-family: Georgia, serif; font-size:1.5rem; }
  ul { list-style:none; padding:0; max-width:40rem; }
  .booking { background:#fff; border:1px solid #E4D9C6; border-radius:12px; padding:1rem 1.25rem; margin-bottom:1rem; }
  .when { font-weight:600; color:#A34A2B; margin-bottom:0.35rem; }
  .msg { color:#5C554A; font-size:0.95rem; white-space:pre-wrap; }
  button { background:#fff; color:#A3402B; border:1.5px solid #A3402B; border-radius:999px;
           padding:0.45rem 1rem; font-weight:600; cursor:pointer; margin-top:0.5rem; }
  button:hover { background:#A3402B; color:#fff; }
  .empty { color:#5C554A; }
</style></head><body>
<h1>Upcoming bookings (${rows.length})</h1>
${rows.length ? `<ul>${items}</ul>` : '<p class="empty">No upcoming bookings.</p>'}
</body></html>`);
  } catch (err) {
    console.error('[admin] list failed:', err);
    res.status(500).send('Failed to load bookings.');
  }
});

app.post('/admin/bookings/:id/cancel', requireAdmin, async (req, res) => {
  if (!dbEnabled) return res.status(503).send('Database is not configured (DATABASE_URL).');
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).send('Bad booking id.');
  try {
    await pool.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [id]);
    res.redirect('/admin/bookings');
  } catch (err) {
    console.error('[admin] cancel failed:', err);
    res.status(500).send('Failed to cancel booking.');
  }
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
app.get('/book', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

// Fallback: send the single page for any other GET (keeps deep links working)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Portfolio site running on http://localhost:${PORT}`);
      if (!emailConfigured) console.log('[email] RESEND_API_KEY not set — emails will be logged to the console.');
      if (!dbEnabled) console.log('[db] DATABASE_URL not set — booking is disabled (contact form still works).');
      if (!ADMIN_PASSWORD) console.log('[admin] ADMIN_PASSWORD not set — /admin/bookings is disabled.');
    });
  })
  .catch((err) => {
    console.error('[db] migration failed:', err);
    process.exit(1);
  });
