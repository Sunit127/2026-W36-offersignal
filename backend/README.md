# OfferSignal API

Optional TypeScript/Node service backed by SQLite for users who explicitly opt in to saving a privacy-reduced check result. The service rejects fields named `message`, `messageText`, and `rawMessage`; the frontend never sends the pasted job text.

## Run

Node.js 22.5+ is required for the built-in `node:sqlite` module.

```bash
cd backend
npm install
npm test
OFFERSIGNAL_CORS_ORIGIN=http://localhost:8080 npm start
```

Endpoints: `GET /healthz`, `POST /api/v1/checks`, and `GET /api/v1/checks/:id`. Bodies are capped at 64 KiB, validated, rate-limited per client, CORS-scoped, and returned with defensive headers. Saved summaries expire after 30 days by default; configure `OFFERSIGNAL_RETENTION_SECONDS` between 5 minutes and 365 days for a different privacy window. Expired rows are rejected and purged during service activity. Store the SQLite file on a protected volume and terminate TLS at a reverse proxy. This API stores a result summary only; it is not an identity-verification or scam verdict service.
