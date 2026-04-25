# In-app feedback — deployment notes

The floating feedback button in `index.html` collects a **category** plus a
free-text **message** and auto-attaches device/page context (URL, current
section, timezone, viewport, user agent, timestamp). There is no sender-email
field — replies go from Chip to whoever pings him separately.

## Current delivery path: FormSubmit (GitHub Pages)

Because this site ships via **GitHub Pages** (see `CNAME`) — a pure static
host with no ability to run server functions — the form posts directly to
[FormSubmit](https://formsubmit.co/) from the browser:

```
POST https://formsubmit.co/ajax/ChipWilkes@gmail.com
Content-Type: application/json
Accept:       application/json
```

FormSubmit forwards the JSON body to `ChipWilkes@gmail.com` as a formatted
email. The payload includes the FormSubmit control fields:

| Field      | Value                                              |
| ---------- | -------------------------------------------------- |
| `_subject` | `Maritimes Grand Loop feedback — <category>`       |
| `_captcha` | `false` (skip the FormSubmit captcha, AJAX flow)   |
| `_template`| `table` (render a clean table in the email body)   |

…plus the actual feedback fields: `category`, `message`, `page_url`,
`page_path`, `section`, `timestamp`, `timezone`, `viewport`, `language`,
`user_agent`.

### ⚠ First-time activation required

FormSubmit requires every new recipient address to confirm once before any
mail will deliver. The very first submission to `ChipWilkes@gmail.com` will
trigger a confirmation email **to Chip** from FormSubmit; he has to click
the activation link in that email. Until that happens, the in-app form will
return an "activate / confirm" response and the UI will surface a friendly
fallback that asks the user to email Chip directly.

After Chip clicks the activation link once, subsequent submissions deliver
normally with no further action needed.

### Why the live UI used to fail with HTTP 405

Before this build, the form posted to `/api/feedback`, which is a Cloudflare
Pages Function. GitHub Pages cannot execute Pages Functions, so every submit
returned **HTTP 405 Method Not Allowed**. The new FormSubmit path removes
that dependency entirely.

## Optional future path: Cloudflare Pages Function (first-party email)

The Cloudflare Pages Function in `functions/api/feedback.ts` is **kept in
the repo as an optional upgrade path** for the day Chip wants first-party
email delivery (custom From address, no third-party broker, full template
control). It is **not** required for the current GitHub Pages deployment
and the front-end no longer calls it.

If/when Chip wants to switch to the Cloudflare path:

1. Create a Cloudflare Pages project pointing at this repo:
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
5. Switch the `fetch(...)` target in `index.html`'s feedback handler back
   to `/api/feedback` (and shape the payload like the Function expects —
   see `functions/api/feedback.ts`).

### Environment variables (Cloudflare path only)

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

#### Local dev (Cloudflare path only)

```
npx wrangler pages dev . --compatibility-date=2025-01-01
```
