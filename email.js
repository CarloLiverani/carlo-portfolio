/**
 * Email delivery via Resend's HTTPS API (SMTP ports are blocked on Railway).
 * Used by both the contact form and the booking flow. Without RESEND_API_KEY
 * the send is skipped and logged so local dev works out of the box.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || 'contact@carlobuilds.com';
const FROM = 'Carlo Liverani <contact@carlobuilds.com>';

const emailConfigured = Boolean(RESEND_API_KEY);

/**
 * Send one email. Resolves true on success, false on any failure — callers
 * that must not fail with the email (like a saved booking) can just log.
 */
async function sendEmail({ to, subject, text, replyTo }) {
  if (!emailConfigured) {
    console.log(`[email] RESEND_API_KEY not set — would send "${subject}" to ${to}:`);
    console.log(text);
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        from: FROM,
        to: [to],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[email] Resend returned ${res.status} for "${subject}": ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] Failed to send "${subject}":`, err.message);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendEmail, emailConfigured, CONTACT_TO_EMAIL };
