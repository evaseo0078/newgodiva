import test from "node:test";
import assert from "node:assert/strict";
import calgaryTime from "../data/calgary-time.js";
import household from "../data/household-calendar.js";
import timeline from "../data/restriction-timeline.js";
import calendar from "../data/restriction-calendar.js";
import { createRestrictionService } from "../lib/restrictions.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("Alberta Time is UTC-6 after the official transition, regardless of host tzdata", () => {
  assert.equal(calgaryTime.timezone, "America/Edmonton");
  assert.equal(calgaryTime.localInstant("2026-11-04", 0, 1), "2026-11-04T06:01:00.000Z");
  assert.match(calgaryTime.format("2026-11-04T06:01:00Z", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }), /12:01.*a\.m\..*ABT/);
  assert.match(calgaryTime.format("2026-11-04T07:01:00Z", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }), /1:01.*a\.m\..*ABT/);
  assert.equal(calgaryTime.dayKey("2026-11-04T06:01:00Z"), "2026-11-04");
  assert.equal(calgaryTime.dayKey("2026-11-04T05:59:00Z"), "2026-11-03");
});

test("historic MST and MDT conversions retain actual daylight saving transitions", () => {
  assert.equal(calgaryTime.localInstant("2025-01-04", 0, 1), "2025-01-04T07:01:00.000Z");
  assert.equal(calgaryTime.localInstant("2025-07-04", 0, 1), "2025-07-04T06:01:00.000Z");
  assert.equal(calgaryTime.localInstant("2025-03-09", 2, 30), null);
  assert.equal(calgaryTime.localInstant("2025-11-02", 1, 30), null);
  assert.match(calgaryTime.format("2025-11-02T07:59:00Z", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }), /1:59.*MDT/);
  assert.match(calgaryTime.format("2025-11-02T08:01:00Z", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }), /1:01.*MST/);
  assert.equal(calgaryTime.localInstant("2026-03-08", 2, 30), null);
});

test("the abolished fall-back and later spring-forwards do not create fake clock gaps", () => {
  assert.match(calgaryTime.format("2026-11-01T08:01:00Z", { hour: "numeric", minute: "2-digit" }), /2:01/);
  assert.equal(calgaryTime.localInstant("2026-11-01", 1, 30), "2026-11-01T07:30:00.000Z");
  assert.equal(calgaryTime.localInstant("2027-03-14", 2, 30), "2027-03-14T08:30:00.000Z");
  assert.equal(calgaryTime.localInstant("2027-11-07", 1, 30), "2027-11-07T07:30:00.000Z");
  assert.equal(calgaryTime.dayKey("invalid"), null);
  assert.equal(calgaryTime.localInstant("2026-02-30", 1), null);
});

test("older extracted instants can be corrected from their preserved source clock time without mutating the audit", () => {
  const event = { id: "legacy-clock", revision: "original", stage: 4, kind: "declaration", source: "https://www.calgary.ca/example/", verifiedAt: "2026-11-04T18:00:00Z", effectiveDate: "2026-11-04", effectiveTime: "00:01", effectiveAt: "2026-11-04T07:01:00Z" };
  assert.equal(timeline.buildTimeline([event]).records[0].startsAt, "2026-11-04T06:01:00.000Z");
  assert.equal(event.effectiveAt, "2026-11-04T07:01:00Z");
});

test("old timezone cache versions force a new verification while retaining fallback status", async () => {
  const now = new Date("2026-11-08T18:00:00Z");
  let calls = 0;
  const old = { schemaVersion: 2, stage: 4, verifiedAt: now.toISOString(), sources: ["https://www.calgary.ca/water/drought.html"] };
  const service = createRestrictionService({ read: async () => old, write: async () => {} });
  const result = await service({ now, fetcher: async () => { calls++; return new Response("<main>Stage 4 water restrictions are in effect. Stage 4 water restrictions began November 4, 2026 at 12:01 am ABT.</main>", { headers: { "content-type": "text/html" } }); } });
  assert.equal(calls, 3);
  assert.equal(result.effectiveFrom, "2026-11-04T06:01:00.000Z");
  assert.equal(result.timezoneVersion, calgaryTime.version);
});

const reading = (date, litres, extra = {}) => ({ date, litres, ...extra });
test("missing household records have no goal outcome rather than being over goal", () => {
  assert.equal(household.dayUsage("2027-01-01", {}, 300), null);
  assert.equal(household.label(null), "No recorded usage");
});

test("calendar goals exclude both demo activities and demo meter readings", () => {
  const data = { logs: { "2027-01-01": [{ litres: 900, demo: true }] }, readings: [reading("2026-12-31", 1000, { demo: true }), reading("2027-01-01", 2000, { demo: true })] };
  assert.equal(household.dayUsage("2027-01-01", data, 300), null);
  data.logs["2027-01-01"].push({ litres: 100 });
  const day = household.dayUsage("2027-01-01", data, 300);
  assert.equal(day.used, 100);
  assert.equal(day.status, "ok");
  assert.equal(day.kind, "logged");
});

test("a real measured zero remains a recorded goal result across a year boundary", () => {
  const data = { readings: [reading("2026-12-31", 1000), reading("2027-01-01", 1000)] };
  const day = household.dayUsage("2027-01-01", data, 300);
  assert.equal(day.used, 0);
  assert.equal(day.status, "ok");
  assert.equal(day.kind, "measured");
});

test("isolated readings and gaps between readings never become an over-goal daily total", () => {
  const data = { readings: [reading("2026-12-28", 1000), reading("2027-01-01", 2000)] };
  const day = household.dayUsage("2027-01-01", data, 300);
  assert.equal(day.status, "unavailable");
  assert.equal(day.used, null);
  assert.equal(household.dayUsage("2026-12-29", data, 300), null);
  assert.equal(household.dayUsage("2026-12-28", data, 300).status, "unavailable");
});

test("negative meter differences fall back only to actual activity records", () => {
  const data = { readings: [reading("2026-12-31", 2000), reading("2027-01-01", 1000)], logs: { "2027-01-01": [{ litres: 100 }] } };
  assert.equal(household.dayUsage("2027-01-01", data, 300).kind, "logged");
  data.logs = {};
  assert.equal(household.dayUsage("2027-01-01", data, 300).status, "unavailable");
});

test("real activity estimates, absent goals and actual over-goal use are distinct", () => {
  const state = { logs: { "2027-01-01": [{ litres: 400 }] } };
  assert.equal(household.dayUsage("2027-01-01", state, 300).status, "over");
  assert.equal(household.dayUsage("2027-01-01", state, 0).status, "unconfigured");
  assert.equal(household.dayUsage("invalid", state, 300), null);
});

test("household record dates follow Alberta Time instead of stale saved date keys", () => {
  const stamp = Date.parse("2026-11-04T06:30:00Z");
  const state = { logs: { "2026-11-03": [{ litres: 50, ts: stamp }] }, readings: [reading("2026-11-03", 1000, { ts: stamp })] };
  assert.equal(household.dayUsage("2026-11-03", state, 300), null);
  assert.equal(household.dayUsage("2026-11-04", state, 300).used, 50);
});

test("construction windows retain documented sources and explicitly derived end dates", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(new URL("../data/config.js", import.meta.url), "utf8"), context);
  const events = context.window.DW_CONFIG.events;
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.equal(event.type, "construction");
    assert.equal(event.approx, true);
    assert.equal(event.endDerived, true);
    assert.match(event.source, /^https:\/\/www\.calgary\.ca\/.*october-22-construction-notice\.pdf$/);
    assert.equal(event.publishedDate, "2026-10-22");
    const estimate = timeline.estimateWindow(event.start, timeline.parseDuration(event.expectedDuration));
    assert.equal(event.end, estimate.latest);
    assert.ok([1, 2].includes(event.sourcePage));
  }
});

test("equal-timestamp browser history prefers corrected timezone metadata without inventing a new verification", () => {
  const original = { id: "phase:4:2026-11-04", kind: "declaration", stage: 4, start: "2026-11-04", end: null, status: "confirmed", startsAt: "2026-11-04T07:01:00Z", source: "https://www.calgary.ca/water/drought.html", verifiedAt: "2026-11-08T18:00:00Z" };
  const corrected = { ...original, startsAt: "2026-11-04T06:01:00Z", timezoneVersion: calgaryTime.version };
  const merged = calendar.mergeRecords([original], [corrected]);
  assert.equal(merged[0].startsAt, corrected.startsAt);
  assert.equal(merged[0].verifiedAt, original.verifiedAt);
  assert.equal(original.startsAt, "2026-11-04T07:01:00Z");
});

test("legacy automatic observations near midnight move to their actual Calgary date without changing the recorded stage", () => {
  const original = { id: "observed:2026-11-07:2", kind: "observation", stage: 2, start: "2026-11-07", end: null, status: "confirmed", source: "https://www.calgary.ca/water/drought.html", verifiedAt: "2026-11-08T06:30:00Z" };
  const merged = calendar.mergeRecords([original]);
  assert.equal(merged[0].start, "2026-11-08");
  assert.equal(merged[0].stage, 2);
  assert.equal(merged[0].verifiedAt, original.verifiedAt);
  assert.equal(original.start, "2026-11-07");
});
