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

Endpoints: `GET /healthz`, `POST /api/v1/checks`, `GET /api/v1/checks/:id`, and `DELETE /api/v1/checks/:id` for explicit retention control. Bodies are capped at 64 KiB, validated, rate-limited per client, CORS-scoped, and returned with defensive headers. Saved summaries expire after 30 days by default; configure `OFFERSIGNAL_RETENTION_SECONDS` between 5 minutes and 365 days for a different privacy window. Expired rows are rejected and purged during service activity. Store the SQLite file on a protected volume and terminate TLS at a reverse proxy. This API stores a result summary only; it is not an identity-verification or scam verdict service.

## Backup and restore

Retention cleanup is request-driven. For a long-running deployment, schedule a maintenance request or an operator job and monitor database size. Back up the SQLite file while the service is stopped (or use SQLite’s online backup command), keep backups access-controlled, and test restores:

```bash
mkdir -p backups
sqlite3 backend/offersignal.sqlite ".backup 'backups/offersignal.sqlite'"
sqlite3 backups/offersignal.sqlite "PRAGMA integrity_check;"
# Restore only after stopping Node and preserving the current file.
cp backend/offersignal.sqlite backend/offersignal.sqlite.before-restore
sqlite3 backend/offersignal.sqlite ".restore 'backups/offersignal.sqlite'"
```

Backups contain privacy-reduced result summaries and IDs. Encrypt them at rest, restrict file permissions, and delete them according to the same retention policy; raw job-message text should never be present.
