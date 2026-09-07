import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
test("team save uses the privacy-safe API", () => {
  assert.match(app, /OFFERSIGNAL_API_BASE/);
  assert.match(app, /\/api\/v1\/checks/);
  assert.match(app, /const\s*\{\s*message,\s*\.\.\.\s*privacySafe\s*\}/);
});
test("raw message fields are excluded from team request", () => {
  const share = app.slice(app.indexOf("async function shareCheck"), app.indexOf("form.addEventListener"));
  assert.doesNotMatch(share, /JSON\.stringify\(current\)/);
  assert.match(share, /JSON\.stringify\(privacySafe\)/);
});
