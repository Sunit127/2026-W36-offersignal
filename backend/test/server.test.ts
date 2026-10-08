import test from "node:test";
import assert from "node:assert/strict";

// Node 22.5+ is required for node:sqlite.
// @ts-ignore
import { DatabaseSync } from "node:sqlite";
import { createServerForDb, migrate } from "../src/server.ts";

test("health and privacy-preserving create/fetch", async (t) => {
  const db = new DatabaseSync(":memory:");
  migrate(db);

  const server = createServerForDb(db);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      resolve();
    }),
  );

  // Always close server and DB in teardown so Node exits cleanly.
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }),
    );
    db.close();
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  // Liveness probes must remain available even when the API quota is exhausted.
  const probes = await Promise.all(
    Array.from({ length: 65 }, () => fetch(base + "/healthz")),
  );
  assert.ok(probes.every((response) => response.status === 200));

  const preflight = await fetch(base + "/api/v1/checks", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:8080",
      "access-control-request-method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("x-content-type-options"), "nosniff");
  assert.equal(preflight.headers.get("cache-control"), "no-store");

  const payload = {
    label: "Remote role",
    channel: "email",
    score: 12,
    level: "low",
    matches: [],
    actions: ["Verify the employer independently."],
  };

  const created = await fetch(`${base}/api/v1/checks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(created.status, 201);

  const saved = await created.json();
  assert.equal(saved.check.label, "Remote role");
  assert.ok(saved.expiresAt > saved.createdAt);

  const fetched = await fetch(`${base}/api/v1/checks/${saved.id}`);
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).check.score, 12);

  const unsupported = await fetch(base + "/api/v1/checks", { method: "POST", body: JSON.stringify(payload) });
  assert.equal(unsupported.status, 415);
  assert.equal(unsupported.headers.get("x-frame-options"), "DENY");

  // Raw message text must be rejected to keep saved content private.
  const raw = await fetch(`${base}/api/v1/checks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, message: "never" }),
  });
  assert.equal(raw.status, 400);

  // Unknown fields must fail closed so the privacy contract cannot broaden silently.
  const unknown = await fetch(`${base}/api/v1/checks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, senderEmail: "recruiter@example.com" }),
  });
  assert.equal(unknown.status, 400);

  // Nested summaries must fail closed instead of being silently truncated.
  const oversizedMatch = await fetch(`${base}/api/v1/checks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...payload,
      matches: [{ id: "rule", title: "x".repeat(161), why: "Reason" }],
    }),
  });
  assert.equal(oversizedMatch.status, 400);

  const blankAction = await fetch(`${base}/api/v1/checks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, actions: ["   "] }),
  });
  assert.equal(blankAction.status, 400);

  const expiredId = "00000000-0000-4000-8000-000000000001";
  db.prepare(
    "INSERT INTO checks(id,payload,created_at,expires_at) VALUES(?,?,?,?)",
  ).run(
    expiredId,
    JSON.stringify(payload),
    "2020-01-01T00:00:00.000Z",
    "2020-01-02T00:00:00.000Z",
  );
  const expired = await fetch(`${base}/api/v1/checks/${expiredId}`);
  assert.equal(expired.status, 404);
});


test("health reports database failures instead of claiming readiness", async (t) => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const server = createServerForDb(db);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  db.close();
  const response = await fetch("http://127.0.0.1:" + address.port + "/healthz");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "database_unavailable" });
});


test("migrate adopts a legacy checks table without a migration ledger", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE checks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)");
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO checks(id,payload,created_at) VALUES(?,?,?)").run(
    "legacy-id",
    "{}",
    createdAt,
  );

  migrate(db);

  const columns = db.prepare("PRAGMA table_info(checks)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "expires_at"));
  assert.equal(
    db.prepare("SELECT version FROM schema_migrations WHERE version=1").get()?.version,
    1,
  );
  assert.ok(
    db.prepare("SELECT expires_at FROM checks WHERE id=?").get("legacy-id")?.expires_at,
  );
  db.close();
});
