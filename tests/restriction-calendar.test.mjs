import test from "node:test";
import assert from "node:assert/strict";
import calendar from "../data/restriction-calendar.js";
import { createHistoryStore } from "../lib/restriction-history.mjs";
import { createRestrictionService, SOURCES, TTL } from "../lib/restrictions.mjs";
import { november } from "./fixtures/restriction-scenarios.js";

const source = "https://newsroom.calgary.ca/example-official-announcement/";
const verifiedAt = "2026-11-08T05:03:33Z";
const record = overrides => ({ id: "example", stage: 2, start: "2026-10-28", end: "2026-11-05", status: "confirmed", source, verifiedAt, ...overrides });
const resolve = (date, records, options = {}) => calendar.resolveDay(date, records, { today: "2026-11-08", ...options });

test("verified spring history crosses month boundaries and preserves April 2 transition", () => {
  for (const date of ["2026-03-09", "2026-03-31", "2026-04-01"]) assert.equal(resolve(date, calendar.records).stage, 4);
  assert.equal(resolve("2026-04-02", calendar.records).status, "transition");
  assert.equal(resolve("2026-03-08", calendar.records).status, "unknown");
  assert.equal(resolve("2026-04-03", calendar.records).message, "Historical data unavailable");
});

test("2024 observations preserve actual announced stages without promoting tentative changes", () => {
  assert.equal(resolve("2024-07-17", calendar.records).stage, 3);
  assert.equal(resolve("2024-07-18", calendar.records).stage, 2);
  assert.equal(resolve("2024-07-22", calendar.records).stage, 2);
  assert.equal(resolve("2024-07-19", calendar.records).stage, null);
  assert.equal(resolve("2024-08-26", calendar.records).stage, 4);
  assert.equal(resolve("2024-08-27", calendar.records).stage, null);
});

test("inclusive historical ranges stop at their confirmed end", () => {
  assert.equal(resolve("2026-10-28", [record()]).stage, 2);
  assert.equal(resolve("2026-11-05", [record()]).stage, 2);
  assert.equal(resolve("2026-11-06", [record()]).stage, null);
});

test("November has a confirmed start, an unknown end and a duration estimate only", () => {
  assert.equal(november.start, "2026-11-04");
  assert.equal(november.end, null);
  assert.match(november.expectedDuration, /Approximately four weeks/);
  assert.equal(resolve("2026-11-04", [november]).stage, 4);
  assert.equal(resolve("2026-12-01", [november]).stage, null);
  assert.equal(resolve("2027-01-01", [november]).status, "unknown");
});

test("open-ended records do not claim uninterrupted history beyond verification", () => {
  const open = record({ end: null, verifiedThrough: "2026-11-02" });
  assert.equal(resolve("2026-11-02", [open]).stage, 2);
  assert.equal(resolve("2026-11-03", [open]).stage, null);
  assert.equal(open.end, null);
});

test("future scheduled and estimated periods stay distinct", () => {
  const scheduled = record({ start: "2026-11-15", end: "2026-11-17", status: "scheduled" });
  const estimated = record({ start: "2026-11-20", end: null, estimatedThrough: "2026-12-03", status: "estimated" });
  assert.equal(resolve("2026-11-16", [scheduled]).status, "scheduled");
  assert.equal(resolve("2026-12-02", [estimated]).status, "estimated");
  assert.equal(estimated.end, null);
  assert.match(resolve("2026-12-04", [estimated]).message, /No official/);
});

test("stage changes within a month remain separate ranges", () => {
  const records = [record({ id: "stage2", end: "2026-11-04" }), record({ id: "stage3", stage: 3, start: "2026-11-05", end: "2026-11-07" })];
  assert.equal(resolve("2026-11-04", records).stage, 2);
  assert.equal(resolve("2026-11-05", records).stage, 3);
});

test("conflicting records produce uncertainty, not a preferred or fabricated stage", () => {
  const records = [record(), record({ id: "other-source", stage: 4 })];
  assert.equal(resolve("2026-11-02", records).status, "conflict");
  assert.equal(resolve("2026-11-02", records).stage, null);
  assert.equal(resolve("2026-11-08", [], { conflict: true }).status, "conflict");
});

test("explicit stage zero is different from missing history", () => {
  assert.equal(resolve("2026-11-02", [record({ stage: 0 })]).stage, 0);
  assert.equal(resolve("2026-11-02", []).stage, null);
  assert.equal(resolve("2025-01-01", []).message, "Historical data unavailable");
});

test("Edmonton date keys handle UTC midnight, DST and invalid input", () => {
  assert.equal(calendar.dayKey("2026-11-08T05:00:00Z"), "2026-11-07");
  assert.equal(calendar.dayKey("2026-07-08T05:00:00Z"), "2026-07-07");
  assert.equal(calendar.dayKey("2026-11-08T06:00:00Z"), "2026-11-08");
  assert.equal(calendar.dayKey("bad"), null);
});

test("month navigation crosses years, leap years and large offsets without network requests", () => {
  assert.equal(calendar.shiftMonth("2026-12-01", 1), "2027-01-01");
  assert.equal(calendar.shiftMonth("2026-01-01", -1), "2025-12-01");
  assert.equal(calendar.shiftMonth("2026-11-01", -120), "2016-11-01");
  for (const month of ["2026-12-01", "2027-01-01", "2024-02-01"]) {
    const grid = calendar.monthGrid(month);
    assert.equal(grid.length, 42);
    assert.equal(grid[0].weekday, 0);
    assert.equal(new Set(grid.map(day => day.key)).size, 42);
  }
  assert.ok(calendar.monthGrid("2024-02-01").some(day => day.key === "2024-02-29"));
});

test("invalid dates and malformed records fail gracefully", () => {
  for (const date of ["2026-02-30", "2026-13-01", "bad", undefined]) {
    assert.equal(calendar.validDate(date), false);
    assert.deepEqual(calendar.monthGrid(date), []);
    assert.equal(calendar.shiftMonth(date, 1), null);
    assert.equal(resolve(date, [record()]).stage, null);
  }
  assert.equal(calendar.shiftMonth("2026-01-01", Number.MAX_SAFE_INTEGER), null);
  assert.equal(calendar.validRecord(record({ source: "https://example.com" })), false);
  assert.equal(calendar.validRecord(record({ end: "2026-01-01" })), false);
  assert.deepEqual(calendar.mergeRecords([record({ stage: 5 })]), []);
});

test("outdated open records are marked stale without rewriting closed history", () => {
  assert.equal(resolve("2026-11-01", [record({ end: null, verifiedThrough: "2026-11-01", verifiedAt: "2026-11-01T12:00:00Z" })], { today: "2026-11-01" }).stale, true);
  assert.equal(resolve("2026-11-02", [record()]).stale, false);
});

test("current updates preserve prior observations without backfilling missing dates", () => {
  const first = calendar.observation({ stage: 4, verifiedAt: "2026-11-08T12:00:00Z", sources: [source] });
  const next = calendar.observation({ stage: 2, verifiedAt: "2026-11-10T12:00:00Z", sources: [source] });
  const history = calendar.mergeRecords([first], [next]);
  assert.equal(history.length, 2);
  assert.equal(resolve("2026-11-08", history, { today: "2026-11-10" }).stage, 4);
  assert.equal(resolve("2026-11-09", history, { today: "2026-11-10" }).stage, null);
  assert.equal(resolve("2026-11-10", history, { today: "2026-11-10" }).stage, 2);
  assert.equal(calendar.observation({ stage: 4, stale: true, verifiedAt, sources: [source] }), null);
});

test("durable storage retains observations after stage updates and process restart", async () => {
  const database = new Map();
  const remote = async command => {
    if (command[0] === "HSET") { database.set(command[2], command[3]); return 1; }
    return [...database.entries()].flat();
  };
  const options = { remote, append: async () => {}, read: async () => "" };
  const first = createHistoryStore(options);
  await first.archive({ stage: 4, verifiedAt: "2026-11-08T12:00:00Z", sources: [source] });
  await first.archive({ stage: 0, verifiedAt: "2026-11-09T12:00:00Z", sources: [source] });
  const restarted = createHistoryStore(options);
  const history = await restarted.get({ stale: false });
  assert.equal(history.storage, "durable");
  assert.ok(history.records.some(value => value.id === "observed:2026-11-08:4"));
  assert.ok(history.records.some(value => value.id === "observed:2026-11-09:0"));
});

test("storage errors preserve in-memory records and expose a warning", async () => {
  const store = createHistoryStore({ remote: async () => { throw new Error("offline"); }, append: async () => {}, read: async () => "invalid\n" });
  await store.archive({ stage: 1, verifiedAt: "2026-11-09T12:00:00Z", sources: [source] });
  const history = await store.get({ stale: true });
  assert.ok(history.warning);
  assert.ok(history.records.some(value => value.stage === 1));
  assert.equal(history.stale, true);
});

test("current verification exposes source conflict while preserving last verified stage", async () => {
  const now = new Date();
  const service = createRestrictionService({ read: async () => null, write: async () => {} });
  const html = stage => new Response(`<main>Stage ${stage} water restrictions are in effect.</main>`, { headers: { "content-type": "text/html" } });
  await service({ now, fetcher: async () => html(2) });
  const result = await service({ now: new Date(+now + TTL + 1), fetcher: async url => html(url === SOURCES[0] ? 2 : 4) });
  assert.equal(result.stage, 2);
  assert.equal(result.stale, true);
  assert.equal(result.verificationIssue, "conflict");
});

test("a conflicting page cannot be ignored when another source has a single declaration", async () => {
  const service = createRestrictionService();
  const result = await service({ persist: false, fetcher: async url => new Response(`<main>Stage 2 water restrictions are in effect. ${url === SOURCES[0] ? "Stage 4 water restrictions are in effect." : ""}</main>`, { headers: { "content-type": "text/html" } }) });
  assert.equal(result.stage, null);
  assert.equal(result.verificationIssue, "conflict");
});
