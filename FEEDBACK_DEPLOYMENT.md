# In-app feedback — deployment notes

The floating feedback button in `index.html` posts to `/api/feedback`.
That endpoint is implemented as a Cloudflare Pages Function in
`functions/api/feedback.ts` and forwards the message to
`ChipWilkes@gmail.com` via SendGrid.

The architecture is patterned on `vigil-family-advisor/server/email.ts`
(Cloudflare Pages + SendGrid), which is what the user already operates.

The form collects only **category** + a free-text **message** + auto-
attached device/page context. There is no sender-email field — replies
go from Chip to whoever pings him separately.

## Hosting reality check

This repo currently ships via **GitHub Pages** (see `CNAME`). GitHub Pages
is a pure static host and **cannot execute Pages Functions** — the
`/api/feedback` POST returns **HTTP 405 (method not allowed)** there, and
the UI surfaces a graceful error pointing the traveler at
`ChipWilkes@gmail.com` directly. Live in-app email delivery only works
after migrating to Cloudflare Pages and setting `SENDGRID_API_KEY`.

To make the button actually deliver email, the site needs to run on a
host that executes the Function. The cheapest path that matches Vigil's
stack is **Cloudflare Pages**.

## Cloudflare Pages setup (one-time)

1. Create the Pages project, connected to this repo:
   - Build command: *(none — pure static)*
   - Build output directory: `.`
   - Functions directory: `functions/` (default; auto-detected)
2. Point `maritimesgrandloop.com` (the value in `CNAME`) at the Pages
   project's custom domain. Remove the GitHub Pages DNS at the same time
   to avoid the two fighting over the apex.
3. In SendGrid, verify a single sender for `no-reply@maritimesgrandloop.com`
   (or whatever you set `SENDGRID_FROM_EMAIL` to). SendGrid will reject
   sends from unverified addresses.
4. Set the secret:
   ```
   wrangler pages secret put SENDGRID_API_KEY --project-name=maritimes-grandloop
   ```
   Optionally override the public vars in `wrangler.toml` via the
   dashboard or `wrangler pages deployment …` if you change the recipient
   or sender.

## Environment variables

| Name                  | Type   | Default                                | Notes                                          |
| --------------------- | ------ | -------------------------------------- | ---------------------------------------------- |
| `SENDGRID_API_KEY`    | secret | *(unset → dev mode, logs only)*        | Required for real email delivery.              |
| `FEEDBACK_TO`         | var    | `ChipWilkes@gmail.com`                 | Recipient.                                     |
| `SENDGRID_FROM_EMAIL` | var    | `no-reply@maritimesgrandloop.com`      | Must be SendGrid-verified.                     |
| `SENDGRID_FROM_NAME`  | var    | `Maritimes Grand Loop`                 | Display name on outgoing mail.                 |

If `SENDGRID_API_KEY` is unset, the Function logs the would-be email and
responds `{ ok: true, dev: true }` — same dev-mode pattern as Vigil's
`server/email.ts`. This lets local `wrangler pages dev` work without
hitting SendGrid.

## Local dev

```
npx wrangler pages dev . --compatibility-date=2025-01-01
```

Open the served URL, click the **Feedback** pill (left of the timezone
pill), submit a test message, and you'll see the formatted email logged
to the wrangler console.

## Staying on GitHub Pages

If migrating hosts is not on the table right now, the front-end change
is still safe to ship: the button will appear, the modal opens, validation
runs, and a failed submit shows a friendly fallback message pointing the
traveler at `ChipWilkes@gmail.com` directly.
