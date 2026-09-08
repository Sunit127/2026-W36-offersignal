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
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

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

  // Raw message text must be rejected to keep saved content private.
  const raw = await fetch(`${base}/api/v1/checks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, message: "never" }),
  });
  assert.equal(raw.status, 400);

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
