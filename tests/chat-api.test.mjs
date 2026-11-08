import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const cacheDirectory = await mkdtemp(join(tmpdir(), "dropwise-chat-test-"));
process.env.TEMP = cacheDirectory; process.env.TMP = cacheDirectory;
process.env.UPSTASH_REDIS_REST_URL = ""; process.env.UPSTASH_REDIS_REST_TOKEN = "";
const { default: handler, toGeminiContents, buildSystemPrompt, classifyError } = await import("../api/chat.js");

function mockRes() {
  return { statusCode: 0, body: null, headers: {},
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
}
const ask = (content, extra = {}) => ({ method: "POST", headers: {}, query: {}, body: { messages: [{ role: "user", content }], context: { siteLanguage: "ko" }, ...extra } });
const geminiOk = (text) => new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
const geminiErr = (status, message, statusText) => new Response(JSON.stringify({ error: { code: status, message, status: statusText } }), { status, headers: { "content-type": "application/json" } });

// Gemini calls go to googleapis; anything else (official City pages) fails, so the restriction status is "unavailable".
async function withGemini(env, gemini, fn) {
  const savedEnv = { ...process.env }, savedFetch = globalThis.fetch, calls = [];
  delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODEL; delete process.env.GEMINI_FALLBACK_MODEL;
  Object.assign(process.env, env);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (/generativelanguage\.googleapis\.com/.test(url)) {
      const headers = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
      const body = JSON.parse(init.body || (typeof input === "object" ? await input.text() : "{}"));
      calls.push({ url, headers, body });
      return gemini(calls.length);
    }
    throw new Error("offline in tests");
  };
  try { return await fn(calls); } finally { process.env = savedEnv; globalThis.fetch = savedFetch; }
}

test("history is trimmed, mapped to Gemini roles and merged so it starts and alternates correctly", () => {
  const c = toGeminiContents([
    { role: "assistant", content: "hello" }, { role: "user", content: "a" }, { role: "user", content: "b" },
    { role: "assistant", content: "c" }, { role: "system", content: "ignore me" }, { role: "user", content: "  " }, { role: "user", content: "d" }]);
  assert.deepEqual(c.map((x) => x.role), ["user", "model", "user"]);
  assert.equal(c[0].parts[0].text, "a\n\nb");
  assert.equal(toGeminiContents(null).length, 0);
});

test("system prompt grounds answers and supports the five site languages", () => {
  const p = buildSystemPrompt({ config: { ruleFacts: ["Fact A"], events: [] }, restrictions: { stage: null }, context: { siteLanguage: "ar", usage: { meter: { readingsSaved: 2, todayStatus: "gap_since_previous_reading" } } } });
  for (const s of ["Fact A", '"stage":null', "Korean", "Simplified Chinese", "Hindi", "Arabic", "reply in Arabic", "Never invent", "cumulativeMeterTotal", "NOT consumption", "readingsSaved > 0", "gap_since_previous_reading"]) assert.ok(p.includes(s), s);
  assert.ok(buildSystemPrompt({ config: {}, restrictions: {}, context: { siteLanguage: "xx" } }).includes("reply in English"));
});

test("not configured → 503 without calling Gemini", async () => {
  await withGemini({}, () => { throw new Error("should not call"); }, async (calls) => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.equal(res.statusCode, 503); assert.equal(res.body.code, "not_configured"); assert.equal(calls.length, 0);
  });
});

test("bad input → 400", async () => {
  await withGemini({ GEMINI_API_KEY: "k" }, () => geminiOk("x"), async () => {
    for (const body of [{}, "not json", { messages: [{ role: "assistant", content: "hi" }] }]) {
      const res = mockRes(); await handler({ method: "POST", body }, res);
      assert.equal(res.statusCode, 400); assert.equal(res.body.code, "bad_request");
    }
  });
});

test("answers through Gemini with the key in a header, system instruction and verified-status grounding", async () => {
  await withGemini({ GEMINI_API_KEY: "secret-key" }, () => geminiOk("샤워는 3분 정도가 좋아요."), async (calls) => {
    const res = mockRes(); await handler(ask("샤워는 얼마나 해야 해요?"), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { reply: "샤워는 3분 정도가 좋아요." });
    assert.equal(calls.length, 1);
    const { url, headers, body } = calls[0];
    assert.match(url, /models\/gemini-3\.5-flash:generateContent/);
    assert.equal(headers.get("x-goog-api-key"), "secret-key");
    assert.ok(!url.includes("secret-key"));
    assert.ok(!JSON.stringify(res.body).includes("secret"));
    assert.equal(body.contents[0].role, "user");
    const sys = JSON.stringify(body.systemInstruction);
    assert.match(sys, /DropBot/); assert.match(sys, /reply in Korean/);
    assert.match(sys, /\\"stage\\":null/, "restriction status could not be verified offline → stage null, never invented");
    assert.equal(body.generationConfig.thinkingConfig, undefined);
    assert.equal(res.headers["Cache-Control"], "no-store");
  });
});

test("GEMINI_MODEL overrides the model", async () => {
  await withGemini({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-2.5-flash" }, () => geminiOk("ok"), async (calls) => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.match(calls[0].url, /gemini-2\.5-flash/);
    assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingBudget, 0);
  });
});

test("rate limits → 429 with Retry-After; provider messages are not forwarded", async () => {
  await withGemini({ GEMINI_API_KEY: "k" }, () => geminiErr(429, "Quota exceeded for project 123", "RESOURCE_EXHAUSTED"), async () => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.equal(res.statusCode, 429); assert.equal(res.body.code, "rate_limited"); assert.equal(res.headers["Retry-After"], "30");
    assert.ok(!JSON.stringify(res.body).includes("project 123"));
  });
});

test("invalid key → 503 not_configured; overload → 503 busy; server errors → 502 unavailable; empty/blocked replies handled", async () => {
  await withGemini({ GEMINI_API_KEY: "bad" }, () => geminiErr(400, "API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT"), async () => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.equal(res.statusCode, 503); assert.equal(res.body.code, "not_configured");
  });
  await withGemini({ GEMINI_API_KEY: "k" }, () => geminiErr(503, "This model is currently experiencing high demand.", "UNAVAILABLE"), async () => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.equal(res.statusCode, 503); assert.equal(res.body.code, "busy"); assert.equal(res.headers["Retry-After"], "30");
  });
  await withGemini({ GEMINI_API_KEY: "k" }, () => geminiErr(500, "internal", "INTERNAL"), async () => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.equal(res.statusCode, 502); assert.equal(res.body.code, "unavailable");
  });
  await withGemini({ GEMINI_API_KEY: "k" }, () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }), { status: 200, headers: { "content-type": "application/json" } }), async () => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.equal(res.statusCode, 422); assert.equal(res.body.code, "blocked");
  });
  assert.equal(classifyError(new Error("fetch failed")).code, "unavailable");
});

test("a busy or retired primary model falls back once to the second model", async () => {
  await withGemini({ GEMINI_API_KEY: "k" }, (n) => n === 1 ? geminiErr(503, "This model is currently experiencing high demand.", "UNAVAILABLE") : geminiOk("fallback answer"), async (calls) => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.reply, "fallback answer");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /gemini-3\.5-flash/); assert.match(calls[1].url, /gemini-3\.8-flash/);
  });
  await withGemini({ GEMINI_API_KEY: "k", GEMINI_MODEL: "old-model" }, (n) => n === 1 ? geminiErr(404, "model is no longer available", "NOT_FOUND") : geminiOk("ok"), async (calls) => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.equal(res.statusCode, 200); assert.equal(calls.length, 2);
  });
  await withGemini({ GEMINI_API_KEY: "bad" }, () => geminiErr(400, "API key not valid.", "INVALID_ARGUMENT"), async (calls) => {
    const res = mockRes(); await handler(ask("hi"), res);
    assert.equal(res.body.code, "not_configured"); assert.equal(calls.length, 1, "a bad key is not retried on another model");
  });
});
