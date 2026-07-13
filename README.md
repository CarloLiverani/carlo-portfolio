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

The form POSTs to `/api/contact`, which sends email through
[Resend](https://resend.com)'s HTTPS API. (This avoids traditional SMTP ports,
which hosts like Railway block.) Until `RESEND_API_KEY` is set, submissions are
**logged to the server console** (and the form still shows success), so the
site works out of the box.

To enable real email delivery, create a Resend API key and set these
environment variables (on Railway: project → Variables):

| Variable             | Example                        | Notes                                              |
| -------------------- | ------------------------------ | -------------------------------------------------- |
| `RESEND_API_KEY`     | `re_xxxxxxxx`                  | **Required.** Your Resend API key                  |
| `CONTACT_TO_EMAIL`   | `carloliverani2011@icloud.com` | Where submissions land (this is the default)       |
| `CONTACT_FROM_EMAIL` | `onboarding@resend.dev`        | Sender address; defaults to Resend's shared sender |

`CONTACT_FROM_EMAIL` defaults to `onboarding@resend.dev`, which works with no
setup. To send from your own domain, verify it in Resend and set this to an
address on that domain.

## Deploy on Railway

1. Push this repo to GitHub and create a new Railway project from it.
2. Railway auto-detects Node and runs `npm start`; the server reads `PORT`
   from the environment automatically.
3. Add the email variables above under **Variables**.
