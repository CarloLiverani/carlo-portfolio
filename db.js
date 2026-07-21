/**
 * PostgreSQL access for the booking feature.
 *
 * Connection comes from DATABASE_URL (on Railway: add a PostgreSQL service
 * and reference its DATABASE_URL variable on this service). When it's not
 * set, the site still runs — booking endpoints report "unavailable" and
 * everything else works as before.
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      // Railway's public DB endpoints require TLS; internal ones don't.
      ssl: /railway\.internal|localhost|127\.0\.0\.1/.test(DATABASE_URL)
        ? false
        : { rejectUnauthorized: false },
    })
  : null;

const dbEnabled = Boolean(pool);

/**
 * Bookings schema. The partial unique index is what makes double-booking
 * impossible even under concurrent requests: two inserts for the same
 * slot_start can't both commit while status='confirmed'. Cancelling a
 * booking flips status to 'cancelled', which frees the slot for rebooking
 * without losing the record.
 */
const MIGRATION = `
  CREATE TABLE IF NOT EXISTS bookings (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    business_name TEXT,
    email         TEXT NOT NULL,
    phone         TEXT NOT NULL,
    message       TEXT,
    slot_start    TIMESTAMPTZ NOT NULL,
    status        TEXT NOT NULL DEFAULT 'confirmed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS bookings_confirmed_slot_uq
    ON bookings (slot_start) WHERE status = 'confirmed';
`;

async function migrate() {
  if (!pool) return;
  await pool.query(MIGRATION);
}

module.exports = { pool, dbEnabled, migrate };
