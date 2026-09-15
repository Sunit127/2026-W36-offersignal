import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
test("team save uses the minimal privacy-safe API contract", () => {
  assert.match(app, /OFFERSIGNAL_API_BASE/);
  assert.match(app, /\/api\/v1\/checks/);
  assert.match(app, /const\\s*\\{[\\s\\S]*label,[\\s\\S]*actions,[\\s\\S]*\\} = currentResult/);
  assert.match(app, /const privacySafe = \\{ label, channel, score, level, matches, actions \\}/);
});
test("raw message fields are excluded from team request", () => {
  const share = app.slice(app.indexOf("async function shareCheck"), app.indexOf("form.addEventListener"));
  assert.doesNotMatch(share, /JSON\\.stringify\\(currentResult\\)/);
  assert.doesNotMatch(share, /senderEmail/);
  assert.match(share, /JSON\\.stringify\\(privacySafe\\)/);
});
