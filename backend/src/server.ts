// @ts-nocheck
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const DB_PATH = process.env.OFFERSIGNAL_DB_PATH || "backend/offersignal.sqlite";
const MAX_BODY = 64 * 1024;
const RATE_LIMIT = Math.max(1, Number(process.env.OFFERSIGNAL_RATE_LIMIT || 60));
const WINDOW_MS = 60_000;
const allowedOrigin = process.env.OFFERSIGNAL_CORS_ORIGIN || "http://localhost:8080";
const hits = new Map<string, number[]>();

export function migrate(db: any) {
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  if (!db.prepare("SELECT version FROM schema_migrations WHERE version=1").get()) {
    db.exec("CREATE TABLE checks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)");
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(new Date().toISOString());
  }
}
export function openDatabase(path = DB_PATH) { const db = new DatabaseSync(path); migrate(db); return db; }
function send(res: ServerResponse, status: number, body: unknown, extra: Record<string,string> = {}) {
  res.writeHead(status, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'","Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type",...extra});
  res.end(JSON.stringify(body));
}
function limited(ip: string) { const now=Date.now(); const recent=(hits.get(ip)||[]).filter(x=>now-x<WINDOW_MS); if (recent.length>=RATE_LIMIT) return true; recent.push(now); hits.set(ip,recent); return false; }
async function body(req: IncomingMessage) {
  let size=0; const chunks: Buffer[]=[];
  for await (const chunk of req) { size+=chunk.length; if(size>MAX_BODY) throw new Error("body-too-large"); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("invalid-json"); }
}
function validate(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("JSON object required");
  if ("message" in input || "messageText" in input || "rawMessage" in input) throw new Error("Raw message text is never accepted by this service");
  if (typeof input.label !== "string" || input.label.trim().length<1 || input.label.trim().length>70) throw new Error("label must be 1-70 characters");
  if (!["email","text","whatsapp","social","jobboard","other"].includes(input.channel)) throw new Error("invalid channel");
  if (!Number.isInteger(input.score) || input.score<0 || input.score>100) throw new Error("score must be an integer from 0 to 100");
  if (!["low","verify","high"].includes(input.level)) throw new Error("invalid level");
  if (!Array.isArray(input.matches) || input.matches.length>20 || !input.matches.every((x:any)=>x && typeof x.id==="string" && typeof x.title==="string" && typeof x.why==="string")) throw new Error("invalid matches");
  if (!Array.isArray(input.actions) || input.actions.length>20 || !input.actions.every((x:any)=>typeof x==="string" && x.length<=400)) throw new Error("invalid actions");
  return {label:input.label.trim(),channel:input.channel,score:input.score,level:input.level,matches:input.matches.map((x:any)=>({id:x.id.slice(0,40),title:x.title.slice(0,160),why:x.why.slice(0,400)})),actions:input.actions.map((x:any)=>x.slice(0,400)),createdAt:new Date().toISOString()};
}
export function createServerForDb(db: any) {
  migrate(db);
  return createServer(async (req,res)=>{
    const ip=(req.socket.remoteAddress||"unknown").replace(/^::ffff:/,"");
    if (req.method==="OPTIONS") { res.writeHead(204,{"Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"}); return res.end(); }
    if (limited(ip)) return send(res,429,{error:"rate_limit_exceeded"},{"Retry-After":"60"});
    if (req.url==="/healthz" && req.method==="GET") return send(res,200,{status:"ok"});
    if (req.url==="/api/v1/checks" && req.method==="POST") {
      try { const input=validate(await body(req)); const id=randomUUID(); const createdAt=new Date().toISOString(); db.prepare("INSERT INTO checks(id,payload,created_at) VALUES(?,?,?)").run(id,JSON.stringify(input),createdAt); return send(res,201,{id,createdAt,check:input}); }
      catch (error:any) { return send(res,error.message==="body-too-large"?413:400,{error:error.message}); }
    }
    const match=req.url?.match(/^\/api\/v1\/checks\/([0-9a-f-]{36})$/);
    if (match && req.method==="GET") { const row=db.prepare("SELECT payload,created_at FROM checks WHERE id=?").get(match[1]); if (!row) return send(res,404,{error:"check_not_found"}); return send(res,200,{id:match[1],createdAt:row.created_at,check:JSON.parse(row.payload)}); }
    return send(res,404,{error:"not_found"});
  });
}
export const app = createServerForDb(openDatabase());
if (process.env.NODE_ENV !== "test") { const port=Number(process.env.PORT||8787); app.listen(port,"127.0.0.1",()=>console.log(`OfferSignal API listening on http://127.0.0.1:${port}`)); }
