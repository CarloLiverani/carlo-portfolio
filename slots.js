/**
 * Booking slot logic.
 *
 * Business rules: Mon–Sat, 10:00–18:00 US Eastern, 30-minute slots
 * (last start 17:30), offered for the next 14 days. Times are stored in
 * UTC and displayed in Eastern; conversion is DST-aware via the Intl API
 * so no timezone library is needed.
 */

const TIME_ZONE = 'America/New_York';
const OPEN_HOUR = 10;          // 10:00 Eastern
const CLOSE_HOUR = 18;         // last slot starts 17:30
const SLOT_MINUTES = 30;
const DAYS_AHEAD = 14;
const MIN_NOTICE_MS = 30 * 60 * 1000; // don't offer slots starting < 30 min from now

// Milliseconds the zone is ahead of UTC at a given instant (negative for US).
function zoneOffsetMs(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - date.getTime();
}

// Convert an Eastern wall-clock time to a UTC Date. The second pass makes
// the result correct on either side of a DST transition; our slots are all
// mid-morning to evening, far from the 2am switchover.
function easternToUtc(year, month, day, hour, minute) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let utc = naive - zoneOffsetMs(new Date(naive));
  utc = naive - zoneOffsetMs(new Date(utc));
  return new Date(utc);
}

// Current date components in Eastern.
function easternToday(now = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = dtf.format(now).split('-').map(Number);
  return { year, month, day };
}

const dayLabelFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric',
});
const timeLabelFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit',
});
const longFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

function formatSlotLong(date) {
  return longFmt.format(date); // e.g. "Tuesday, July 22, 10:30 AM EDT"
}

/**
 * All bookable slots for the next DAYS_AHEAD days, grouped by Eastern day.
 * Each day: { key: 'YYYY-MM-DD', label: 'Tue, Jul 22', slots: [{iso, label}] }
 * Days with no remaining slots (e.g. Sundays, or today after closing) are
 * omitted.
 */
function generateSlots(now = new Date()) {
  const cutoff = now.getTime() + MIN_NOTICE_MS;
  const { year, month, day } = easternToday(now);
  const days = [];

  for (let i = 0; i < DAYS_AHEAD; i++) {
    // Walk forward one Eastern calendar day at a time. Using noon UTC of the
    // base date avoids any day-boundary ambiguity.
    const d = new Date(Date.UTC(year, month - 1, day + i, 12));
    const dy = d.getUTCFullYear();
    const dm = d.getUTCMonth() + 1;
    const dd = d.getUTCDate();

    const probe = easternToUtc(dy, dm, dd, 12, 0);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' }).format(probe);
    if (weekday === 'Sun') continue;

    const slots = [];
    for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
      for (let m = 0; m < 60; m += SLOT_MINUTES) {
        const slot = easternToUtc(dy, dm, dd, h, m);
        if (slot.getTime() < cutoff) continue;
        slots.push({ iso: slot.toISOString(), label: timeLabelFmt.format(slot) });
      }
    }
    if (slots.length === 0) continue;

    days.push({
      key: `${dy}-${String(dm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
      label: dayLabelFmt.format(probe),
      slots,
    });
  }
  return days;
}

/**
 * Server-side check that a submitted ISO string is exactly one of the slots
 * we currently offer. Prevents booking arbitrary times (past dates, Sundays,
 * off-grid minutes, or beyond the 14-day window).
 */
function isValidSlot(iso, now = new Date()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const wanted = new Date(t).toISOString();
  return generateSlots(now).some((day) => day.slots.some((s) => s.iso === wanted));
}

module.exports = { generateSlots, isValidSlot, formatSlotLong, TIME_ZONE };
