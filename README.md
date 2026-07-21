# Carlo Liverani — Portfolio

Portfolio site for my freelance web development business: a single-page
site plus an online booking flow, served by a small Node.js/Express server
with PostgreSQL.

- `/` — the portfolio page (contact form emails me)
- `/book` — visitors book a free 15-minute consultation
- `/admin/bookings` — password-protected list of upcoming bookings

## Run locally

```bash
npm install
npm start
# → http://localhost:3000
```

Without any environment variables the site still runs: emails are logged to
the console, booking is disabled (the page says so), and admin is off.

## Environment variables

Set these on Railway under the service's **Variables** tab:

| Variable         | Example                   | Notes                                                       |
| ---------------- | ------------------------- | ----------------------------------------------------------- |
| `RESEND_API_KEY` | `re_xxxxxxxx`             | Enables email (contact form + booking notifications)        |
| `CONTACT_TO_EMAIL` | `contact@carlobuilds.com` | Where notifications land (this is the default)            |
| `DATABASE_URL`   | *(from Railway Postgres)* | Enables the booking feature                                 |
| `ADMIN_PASSWORD` | *(pick a strong one)*     | Enables `/admin/bookings` (any username, this password)     |

Emails send from `Carlo Liverani <contact@carlobuilds.com>` — the domain is
verified in Resend.

## Booking feature

- Free 15-minute consultation slots: **Mon–Sat, 10am–6pm US Eastern**, in
  30-minute increments, offered for the next 14 days (30-minute minimum
  notice). Times are stored in UTC and displayed in Eastern; DST is handled.
- Double-booking is impossible: a partial unique index on
  `bookings(slot_start) WHERE status = 'confirmed'` settles concurrent
  requests, and the loser sees "that slot just got taken."
- Bot protection: hidden honeypot field (silently accepted, never saved) and
  a rate limit of 3 booking submissions per IP per hour.
- Cancelling from `/admin/bookings` sets `status = 'cancelled'`, which frees
  the slot for rebooking while keeping the record.
- The `bookings` table is created automatically at boot (idempotent).

## Deploy on Railway

1. In the Railway project, click **+ New → Database → PostgreSQL**.
2. On the web service, add a variable `DATABASE_URL` referencing the
   database: `${{Postgres.DATABASE_URL}}` (Railway suggests this when you
   start typing).
3. Add `ADMIN_PASSWORD` (and the email variables above if not already set).
4. Railway auto-detects Node and runs `npm start`; the server reads `PORT`
   automatically. The bookings table creates itself on first boot.
