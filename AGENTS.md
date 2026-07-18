# AGENTS.md

This file mirrors `CLAUDE.md`. Whichever AI coding agent or tool you are —
Claude, Codex, Cursor, or anything else — read this before making changes.

## Project overview

Qantas PaySlip Verifier — a personal, single-user Progressive Web App for a
Qantas Level 5 airport customer service employee (Sydney Mascot). It logs
daily clock-in/clock-out times, calculates expected pay under the relevant
EBA rules (weekday time-of-day loadings, Saturday/Sunday/public holiday
rates, overtime, transport/tea allowances, 48-hour-notice-change penalties),
and lets the owner cross-check that calculation against her real fortnightly
payslip — including by uploading a photo or PDF of the payslip for
OCR-assisted auto-fill.

Stack: plain HTML/CSS/JS, no framework, no build step, no backend.
Files: `index.html`, `app.js`, `manifest.json`, `sw.js`, icons.
Hosting: GitHub Pages (static files only — GitHub never runs any server-side
code for this app and never receives user data beyond the static assets
themselves).

The UI/service language must always be **English** (real usage country is
Australia) — `index.html`, `app.js`, `manifest.json`, and `sw.js` must contain
no Korean text. `README.md` may stay in Korean since it is developer/owner
notes, not part of the running app.

## Security & privacy policy — read before touching anything

This app handles sensitive personal financial data: real payslip photos/PDFs,
pay rates, hours worked, and bank-relevant figures. Its entire value
proposition to the owner rests on one guarantee: **everything stays on the
user's own device. Nothing personal is ever uploaded anywhere.** Any change
that weakens this guarantee — even accidentally — is a serious regression,
not a minor bug.

### The non-negotiable rule

Code in this repo must never transmit any of the following over the network,
to any destination:

- the raw payslip photo/PDF the user uploads, or any image/canvas derived
  from it
- OCR-extracted text, or any pay figures parsed from a payslip
- anything read from or written to localStorage (`qpv_profile_v1`,
  `qpv_shifts_v1`, `qpv_payslips_v1`, `qpv_open_shift_v1`) — profile info,
  shift logs, rate history, saved payslip comparisons

The **only** acceptable outbound network calls this app makes are to public
CDNs, to download fixed, versioned **library code** (not user data):

- `cdn.jsdelivr.net/npm/tesseract.js@5.0.5/...` — OCR engine
- `cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/...` — PDF rendering engine

These must remain plain `<script src="...">` loads of a pinned version, with
no user data ever appended as a query string, path segment, or POST body.

### Mandatory check before every commit that touches JS

Before committing any change to `app.js` (or adding any new script), run:

```bash
grep -nE "fetch\(|XMLHttpRequest|axios|\.send\(|sendBeacon|new Image\(|WebSocket\(|\.postMessage\(" app.js
```

For every match, verify and be able to state clearly to the user:

1. The destination is one of the known static CDN library URLs above (or a
   newly-approved one — see below) and not some other endpoint.
2. No variable holding user data (canvas/image bytes, OCR text, parsed pay
   figures, anything from localStorage) is included in the URL, request
   body, or headers of that call.

If this check turns up anything that isn't a pinned CDN library load, treat
it as a potential privacy leak: stop, do not commit, and flag it to the user
explicitly rather than assuming it's fine.

### If a future feature needs to send data off-device

Later phases of this project (e.g. sharing with colleagues) may eventually
need real network calls that carry user data. If and when that happens:

- It must be opt-in, never default-on.
- The UI must clearly disclose, at the point of upload/action, exactly what
  data is being sent and to where.
- Get the user's explicit sign-off before implementing it, since it changes
  the app's core "100% local, nothing leaves your phone" privacy promise —
  don't silently add this as a side effect of an unrelated feature.

### Current network footprint (keep this section up to date)

As of the payslip-scan feature, the complete list of outbound requests
`app.js` makes is:

- `cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js`
- `cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js`
- `cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`

All three are library code downloads only. There is no analytics, no
tracking pixel, no error-reporting/telemetry call, and no API of any kind.
If you add or remove a network call, update this list in the same commit.

### Data storage model

All user data lives only in the browser's `localStorage`, on the user's own
device. There is no backend, no database, no server-side storage of any
kind. GitHub / GitHub Pages only ever stores and serves the static app code
in this repo — never the user's payslip data, hours, or rates.

## Other established constraints — do not violate without asking

- Keep the app UI in English only (see above).
- Don't add new fields that store additional personal data without first
  confirming with the user how and where that data will live.
- Some payslip line items (e.g. `SPEC-PENLTY`, `50%/100% NIL 48`,
  `A/LVE PREM`) have deliberately uncertain trigger conditions and are
  intentionally left out of auto-calculation, routed instead to a manual
  "other items" bucket. Don't "fix" this by guessing a formula — wait for
  confirmed real payslip data, per the user's stated preference.
