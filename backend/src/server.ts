// @ts-nocheck
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const DB_PATH = process.env.OFFERSIGNAL_DB_PATH || "offersignal.sqlite";
const IS_TEST = process.env.NODE_ENV === "test";
const MAX_BODY = 64 * 1024; // Maximum accepted payload size in bytes.
const RATE_LIMIT = Math.max(1, Number(process.env.OFFERSIGNAL_RATE_LIMIT || 60));
const WINDOW_MS = 60_000;
const ALLOWED_ORIGIN = process.env.OFFERSIGNAL_CORS_ORIGIN || "http://localhost:8080";
const hits = new Map<string, number[]>();

export function migrate(db: any) {
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations " +
      "(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version=1").get()) {
    db.exec(`
      CREATE TABLE checks (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    db.prepare(
      "INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)",
    ).run(new Date().toISOString());
  }
}

export function openDatabase(path = DB_PATH) {
  // In test mode, the caller may pass :memory: to avoid persistent artifacts.
  const db = new DatabaseSync(path);
  migrate(db);
  return db;
}

function sendJsonResponse(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function isRateLimited(ip: string) {
  const now = Date.now();
  const prior = (hits.get(ip) || []).filter(
    (timestamp) => now - timestamp < WINDOW_MS,
  );
  if (prior.length >= RATE_LIMIT) {
    // Reject rapid bursts before parsing body or touching disk.
    return true;
  }

  prior.push(now);
  hits.set(ip, prior);
  return false;
}

async function readRequestBody(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      throw new Error("body-too-large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid-json");
  }
}

function validateInput(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("JSON object required");
  }

  if ("message" in input || "messageText" in input || "rawMessage" in input) {
    throw new Error("Raw message text is never accepted by this service");
  }

  if (typeof input.label !== "string" || input.label.trim().length < 1 || input.label.trim().length > 70) {
    throw new Error("label must be 1-70 characters");
  }

  if (
    !["email", "text", "whatsapp", "social", "jobboard", "other"].includes(
      input.channel,
    )
  ) {
    throw new Error("invalid channel");
  }

  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 100) {
    throw new Error("score must be an integer from 0 to 100");
  }

  if (!["low", "verify", "high"].includes(input.level)) {
    throw new Error("invalid level");
  }

  if (
    !Array.isArray(input.matches)
    || input.matches.length > 20
    || !input.matches.every((entry: any) => {
      return (
        entry &&
        typeof entry.id === "string" &&
        typeof entry.title === "string" &&
        typeof entry.why === "string"
      );
    })
  ) {
    throw new Error("invalid matches");
  }

  if (
    !Array.isArray(input.actions)
    || input.actions.length > 20
    || !input.actions.every((value: any) => {
      return typeof value === "string" && value.length <= 400;
    })
  ) {
    throw new Error("invalid actions");
  }

  return {
    label: input.label.trim(),
    channel: input.channel,
    score: input.score,
    level: input.level,
    matches: input.matches.map((entry: any) => ({
      id: entry.id.slice(0, 40),
      title: entry.title.slice(0, 160),
      why: entry.why.slice(0, 400),
    })),
    actions: input.actions.map((value: any) => value.slice(0, 400)),
    createdAt: new Date().toISOString(),
  };
}

export function createServerForDb(db: any) {
  migrate(db);

  return createServer(async (req, res) => {
    const ip = (req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
    if (req.method === "OPTIONS") {
      // CORS preflight should always be answered quickly.
      res.writeHead(204, {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    if (isRateLimited(ip)) {
      return sendJsonResponse(
        res,
        429,
        { error: "rate_limit_exceeded" },
        { "Retry-After": "60" },
      );
    }

    if (req.url === "/healthz" && req.method === "GET") {
      return sendJsonResponse(res, 200, { status: "ok" });
    }

    if (req.url === "/api/v1/checks" && req.method === "POST") {
      try {
        const check = validateInput(await readRequestBody(req));
        const checkId = randomUUID();
        const createdAt = new Date().toISOString();
        db.prepare(
          "INSERT INTO checks(id,payload,created_at) VALUES(?,?,?)",
        ).run(
          checkId,
          JSON.stringify(check),
          createdAt,
        );
        return sendJsonResponse(res, 201, { id: checkId, createdAt, check });
      } catch (error: any) {
        const statusCode = error.message === "body-too-large" ? 413 : 400;
        return sendJsonResponse(res, statusCode, { error: error.message });
      }
    }

    const checkIdMatch = req.url?.match(/^\/api\/v1\/checks\/([0-9a-f-]{36})$/);
    if (checkIdMatch && req.method === "GET") {
      const row = db.prepare(
        "SELECT payload,created_at FROM checks WHERE id=?",
      ).get(checkIdMatch[1]);
      if (!row) {
        return sendJsonResponse(res, 404, { error: "check_not_found" });
      }
      return sendJsonResponse(res, 200, {
        id: checkIdMatch[1],
        createdAt: row.created_at,
        check: JSON.parse(row.payload),
      });
    }

    return sendJsonResponse(res, 404, { error: "not_found" });
  });
}

export const app = createServerForDb(openDatabase(IS_TEST ? ":memory:" : DB_PATH));

if (!IS_TEST) {
  const port = Number(process.env.PORT || 8787);
  app.listen(port, "127.0.0.1", () => {
    console.log(`OfferSignal API listening on http://127.0.0.1:${port}`);
  });
}
