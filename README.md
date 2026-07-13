# Carlo Liverani — Portfolio

Single-page portfolio site for my freelance web development business.
Static `index.html` (embedded CSS + minimal JS) served by a small
Node.js/Express server, with a contact form that emails submissions to me.

## Run locally

```bash
npm install
npm start
# → http://localhost:3000
```

## Contact form email setup

The form POSTs to `/api/contact`. Until email is configured, submissions are
**logged to the server console** (and the form still shows success), so the
site works out of the box.

To enable real email delivery, set these environment variables (on Railway:
project → Variables). Any SMTP provider works — Resend, Postmark, SendGrid,
Mailgun, or a Gmail app password:

| Variable             | Example                    | Notes                              |
| -------------------- | -------------------------- | ---------------------------------- |
| `SMTP_HOST`          | `smtp.resend.com`          | Your provider's SMTP host          |
| `SMTP_PORT`          | `587`                      | Optional, defaults to 587          |
| `SMTP_USER`          | `resend`                   | SMTP username / API key name       |
| `SMTP_PASS`          | `re_xxxxxxxx`              | SMTP password / API key            |
| `CONTACT_TO_EMAIL`   | `carlo@example.com`        | Where submissions are delivered    |
| `CONTACT_FROM_EMAIL` | `portfolio@yourdomain.com` | Sender address (must be verified with most providers) |

Also update the two `you@example.com` placeholders in
`public/index.html` (the "Prefer email?" link in the contact section).

## Deploy on Railway

1. Push this repo to GitHub and create a new Railway project from it.
2. Railway auto-detects Node and runs `npm start`; the server reads `PORT`
   from the environment automatically.
3. Add the email variables above under **Variables**.

## Adding real project screenshots

In `public/index.html`, each project card contains a
`<div class="shot-placeholder">`. Replace it with an image tag, e.g.:

```html
<img src="/images/project-1.png" alt="Screenshot of the project" loading="lazy">
```

and drop your screenshots into `public/images/`.
