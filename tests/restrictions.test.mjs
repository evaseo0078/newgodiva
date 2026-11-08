import test from "node:test";
import assert from "node:assert/strict";
import model from "../data/restrictions.js";
import { createRestrictionService, extractStatus, getRestrictions, SOURCES, validSnapshot, TTL } from "../lib/restrictions.mjs";

const response = text => new Response(`<main>${text}</main>`, { headers: { "content-type": "text/html" } });

for (const stage of [0, 1, 2, 3, 4]) {
  test(`official current status ${stage} and corresponding rules`, async () => {
    const text = stage ? `City-wide Stage ${stage} outdoor water restrictions are in effect.` : "No outdoor water restrictions are in effect.";
    assert.equal(extractStatus(`<main>${text}</main>`).stage, stage);
    const result = await getRestrictions({ persist: false, fetcher: async () => response(text) });
    assert.equal(result.stage, stage);
    assert.equal(result.stale, false);
    assert.equal(result.rules.fineAmount, [null, 400, 600, 1500, 3000][stage]);
    assert.ok(result.verifiedAt);
    assert.equal(result.effectiveTo, null);
    assert.deepEqual(result.sources, SOURCES);
  });
}

test("normal schedule, edible crop and Stage 3 hand-watering exceptions", () => {
  assert.match(model.stages[0].allowed.join(" "), /year-round/);
  assert.match(model.stages[0].fine, /\$200/);
  assert.match(model.stages[1].allowed.join(" "), /2 hours/);
  assert.match(model.stages[2].allowed.join(" "), /1 hour/);
  assert.match(model.stages[3].allowed.join(" "), /Hand watering non-edible/);
  assert.match(model.stages[4].allowed.join(" "), /Edible crops/);
  assert.match(model.stages[4].notAllowed.join(" "), /Hand watering non-edible/);
});

test("does not promote future, historical, negated or ambiguous statements", () => {
  for (const text of [
    "Stage 4 water restrictions will be in effect starting November 4.",
    "Stage 4 water restrictions were in effect last year.",
    "Stage 4 water restrictions are not in effect.",
    "Stage 4 water restrictions are in effect. No outdoor water restrictions are in effect.",
    "Stage 1 Stage 2 Stage 3 Stage 4: understand all restrictions.",
    "Construction will take approximately four weeks."
  ]) assert.throws(() => extractStatus(`<main>${text}</main>`));
});

test("scripts and navigation cannot declare a status", () => {
  assert.throws(() => extractStatus('<main><script>Stage 4 water restrictions are in effect.</script><nav>Stage 3 water restrictions are in effect.</nav></main>'));
});

test("conflicting official declarations fail closed", async () => {
  const result = await getRestrictions({ persist: false, fetcher: async url => response(`Stage ${url === SOURCES[0] ? 2 : 4} water restrictions are in effect.`) });
  assert.equal(result.stage, null);
  assert.equal(result.stale, true);
});

test("timeout, malformed HTML and non-HTML responses do not imply Stage 4", async () => {
  for (const fetcher of [async () => { throw new Error("Timeout"); }, async () => response("Access denied"), async () => new Response("Stage 4 water restrictions are in effect.")]) {
    const result = await getRestrictions({ persist: false, fetcher });
    assert.equal(result.stage, null);
    assert.equal(result.rules, null);
    assert.equal(result.stale, true);
  }
});

test("one explicit official declaration is sufficient when the other page has no current claim", async () => {
  const result = await getRestrictions({ persist: false, fetcher: async url => response(url === SOURCES[0] ? "Stage 2 water restrictions are in effect." : "Future construction starts next month.") });
  assert.equal(result.stage, 2);
  assert.equal(result.sources.length, 1);
});

test("cache validation rejects missing timestamps, unknown stages and unofficial URLs", () => {
  assert.ok(validSnapshot({ stage: 0, verifiedAt: new Date().toISOString(), sources: SOURCES }));
  for (const value of [{ stage: 4 }, { stage: 5, verifiedAt: new Date().toISOString(), sources: SOURCES }, { stage: 4, verifiedAt: "bad", sources: SOURCES }, { stage: 4, verifiedAt: new Date().toISOString(), sources: ["https://example.com"] }]) assert.ok(!validSnapshot(value));
});

test("cache avoids repeated fetches and preserves the timestamp on verification failure", async () => {
  let stored = null, requests = 0;
  const service = createRestrictionService({ read: async () => stored, write: async value => { stored = value; } });
  const now = new Date();
  const fetcher = async () => { requests++; return response("Stage 3 water restrictions are in effect."); };
  const first = await service({ now, fetcher });
  assert.equal(requests, 3);
  const cached = await service({ now: new Date(+now + 1000), fetcher });
  assert.equal(requests, 3);
  assert.equal(cached.verifiedAt, first.verifiedAt);
  const failure = await service({ now: new Date(+now + TTL + 1), fetcher: async () => { throw new Error("offline"); } });
  assert.equal(failure.stage, 3);
  assert.equal(failure.stale, true);
  assert.equal(failure.verifiedAt, first.verifiedAt);
  const restarted = createRestrictionService({ read: async () => stored, write: async () => {} });
  const afterRestart = await restarted({ now: new Date(+now + TTL + 1000), fetcher: async () => { throw new Error("offline"); } });
  assert.equal(afterRestart.stage, 3);
  assert.equal(afterRestart.stale, true);
});

test("recovers when a fresh official declaration changes the stage", async () => {
  const now = new Date();
  const service = createRestrictionService({ read: async () => null, write: async () => {} });
  await service({ now, fetcher: async () => response("Stage 4 water restrictions are in effect.") });
  const result = await service({ now: new Date(+now + TTL + 1), fetcher: async () => response("No outdoor water restrictions are in effect.") });
  assert.equal(result.stage, 0);
  assert.equal(result.stale, false);
});
