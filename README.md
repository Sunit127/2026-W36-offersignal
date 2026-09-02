# OfferSignal

OfferSignal is a responsive, installable, local-first job-offer screening tool. Applicants paste a recruiter message and add a small amount of context; a transparent rules engine identifies documented payment, task, identity, pressure, and process patterns, then produces a verification checklist.

It does **not** declare an offer legitimate or fraudulent, identify a sender, replace law enforcement, or provide legal advice.

## User stories

- As a job seeker, I can pause and review an exciting message before sharing money or personal data.
- As a career adviser, I can explain exactly which patterns deserve verification.
- As a privacy-conscious user, I can analyze a message without uploading it or creating an account.
- As a user, I can save checks, reopen them, copy next steps, and export a privacy-reduced history.

## Architecture

OfferSignal is a dependency-free static PWA. `logic.js` contains the deterministic and unit-tested rules engine. `app.js` handles the UI and browser `localStorage`. `sw.js` caches the app shell for offline use. There is no server, AI provider, analytics, or external integration.

The rules return matched categories and their rationale rather than a black-box verdict. An independently verified official-careers-site match lowers the signal score but never marks an offer safe.

## Setup and run

Requirements: Node.js 20+ and Python 3 for the optional static server.

```bash
npm install
npm run verify
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Build and tests

```bash
npm run check   # JavaScript syntax checks
npm test        # Unit tests for critical matching and validation logic
npm run build   # Creates the static deployable dist/ directory
npm run smoke   # Serves dist/ and verifies its primary route and logic asset
```

No secrets or configuration are needed. `.env.example` only documents the optional smoke-test port.

## Validation, errors, and accessibility

Offer labels, email format, and message length are validated. Helpful errors use an alert region. Results use a live region, keyboard focus is visible, fields and groups have labels, and the interface does not depend on color alone. Layouts adapt to narrow screens.

## Privacy and security

- Analysis runs entirely on the device; message text is never transmitted.
- Saved checks remain in this browser until deleted.
- JSON export deliberately omits original message bodies.
- Users are reminded to remove sensitive details before pasting.
- User-provided text is rendered with `textContent`, not HTML.
- No remote scripts, trackers, cookies, credentials, or hidden integrations.

## Evidence and rationale

The FTC reported in May 2026 that imposter scams remained the most reported scam type for the ninth year, with over one million 2025 reports and $3.5 billion in reported losses. FTC job-scam guidance warns about personal email accounts and requests for sensitive information before a real interview. The FBI’s 2025 IC3 report describes AI-assisted employment scams and almost $13 million in reported losses tied to AI-involved employment scams.

- [FTC — New trends in reports of imposter scams](https://consumer.ftc.gov/consumer-alerts/2026/05/new-trends-reports-imposter-scams)
- [FTC — Job scammers are looking to hire you](https://consumer.ftc.gov/consumer-alerts/2025/07/job-scammers-are-looking-hire-you)
- [FBI IC3 — 2025 Internet Crime Report](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf)

A local-first PWA is appropriate because job messages can contain sensitive personal context, users need immediate help on phones, and the core value does not require private databases or paid credentials.

## Limitations

- Rules can miss new tactics, euphemisms, images, non-English content, or off-message context.
- Matching language can appear in legitimate warnings or discussions; results are not proof.
- The app cannot verify identity, domains, company registrations, or job listings.
- Saved checks do not sync across devices.
- Guidance links are US-focused; users elsewhere should use their national reporting and identity-theft services.

## Responsible production path

Have fraud-prevention specialists review rules and wording; publish a versioned evidence map and update cadence; localize patterns and official reporting paths; test with job seekers and career counselors; add optional on-device multilingual models only after privacy and bias evaluation; conduct accessibility and threat-model reviews; and deploy over HTTPS with a strict Content Security Policy.
