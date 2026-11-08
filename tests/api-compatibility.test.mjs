import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const cacheDirectory = await mkdtemp(join(tmpdir(), "dropwise-api-test-"));
process.env.TEMP = cacheDirectory;
process.env.TMP = cacheDirectory;
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";
const names = ["chat", "discord", "gemini", "health", "news", "restrictions", "statcan"];
const handlers = new Map(await Promise.all(names.map(async name => [name, (await import(`../api/${name}.js`)).default])));
function response() {
  return { code: null, payload: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.payload = value; return this; } };
}

test("all seven existing API handlers remain importable as ES modules", () => {
  for (const [name, handler] of handlers) assert.equal(typeof handler, "function", name);
});

test("guarded API handlers reject unsupported methods without external requests", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected external request"); };
  try {
    for (const name of ["chat", "discord", "gemini", "restrictions"]) {
      const output = response();
      await handlers.get(name)({ method: name === "restrictions" ? "POST" : "DELETE", query: {}, headers: {} }, output);
      assert.equal(output.code, 405, name);
    }
  } finally { globalThis.fetch = original; }
});

test("restriction GET includes structured dates, source evidence, rules and retained history", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(url, /^https:\/\/(?:www\.calgary\.ca|newsroom\.calgary\.ca)\//);
    return new Response("<main>Stage 2 water restrictions are in effect. Stage 2 water restrictions began May 3, 2026 at 6:00 am for approximately two weeks.</main>", { headers: { "content-type": "text/html" } });
  };
  try {
    const output = response();
    await handlers.get("restrictions")({ method: "GET" }, output);
    assert.equal(output.code, 200);
    assert.equal(output.headers["Cache-Control"], "no-store");
    assert.equal(output.payload.stage, 2);
    assert.equal(output.payload.rules.label, "Stage 2");
    assert.equal(output.payload.effectiveFrom, "2026-05-03T12:00:00.000Z");
    assert.equal(output.payload.effectiveTo, null);
    assert.equal(output.payload.expectedWindow.latest, "2026-05-16");
    assert.equal(output.payload.history.timelineVersion, 2);
    assert.ok(output.payload.history.audit.length);
    assert.ok(output.payload.history.records.some(record => record.id === "phase:2:2026-05-03"));
    assert.ok(output.payload.history.records.some(record => record.start === "2024-07-17"));
  } finally { globalThis.fetch = original; }
});
