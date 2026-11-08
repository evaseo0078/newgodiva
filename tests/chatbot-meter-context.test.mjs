import test from "node:test";
import assert from "node:assert/strict";
import MU from "../data/meter-usage.js";
import { contextJSON, buildSystemPrompt } from "../api/chat.js";

const H = 3600e3, NOW = Date.UTC(2026, 10, 9, 18); // 2026-11-09 11:00 Calgary (MST)
const dayOf = (ts) => new Date(ts - 7 * H).toISOString().slice(0, 10);
const today = dayOf(NOW);
let n = 0;
const r = (hoursAgo, value, extra = {}) => ({ id: "r" + ++n, ts: NOW - hoursAgo * H, value, unit: "m3", litres: MU.toLitres(value, "m3"), by: "u", ...extra });
const ctx = (readings, residents = 3) => MU.meterContext(readings, { residents, today, dayOf, now: NOW });

test("no readings → explicitly unknown, never zero", () => {
  const c = ctx([]);
  assert.equal(c.readingsSaved, 0); assert.equal(c.todayStatus, "no_meter_readings"); assert.equal(c.todayMeasuredLitres, null);
});

test("a single saved reading is reported as a cumulative total, not consumption", () => {
  const c = ctx([r(1, 1234.567)]);
  assert.equal(c.readingsSaved, 1);
  assert.equal(c.latestReading.cumulativeMeterTotal, "1234.567 m³");
  assert.match(c.latestReading.note, /NOT consumption/);
  assert.equal(c.todayStatus, "first_reading");
  assert.equal(c.todayMeasuredLitres, null);
  assert.deepEqual(c.recentIntervals, []);
  assert.equal(c.average7Days, null);
});

test("readings yesterday and today → measured today over the real interval", () => {
  const c = ctx([r(24, 100), r(1, 100.65)]);
  assert.equal(c.todayStatus, "measured");
  assert.equal(c.todayMeasuredLitres, 650);
  assert.equal(c.recentIntervals[0].litresUsed, 650);
  assert.equal(c.recentIntervals[0].hours, 23);
  assert.equal(c.recentIntervals[0].litresPerDay, Math.round(650 / (23 / 24)));
  assert.equal(c.recentIntervals[0].litresPerPersonPerDay, Math.round(650 / (23 / 24) / 3));
});

test("a multi-day gap is an interval average, never today's use", () => {
  const c = ctx([r(96, 100), r(1, 102.4)]); // 4 days apart
  assert.equal(c.todayStatus, "gap_since_previous_reading");
  assert.equal(c.todayMeasuredLitres, null);
  assert.match(c.todayExplanation, /latest reading is from today/);
  assert.match(c.todayExplanation, /about 4 days earlier — not from yesterday/);
  assert.equal(c.recentIntervals[0].litresUsed, 2400);
  assert.equal(c.recentIntervals[0].litresPerDay, Math.round(2400 / (95 / 24)));
});

test("two readings today only → partial interval, no daily rate", () => {
  const c = ctx([r(5, 50), r(1, 50.12)]);
  assert.equal(c.todayStatus, "only_readings_from_today");
  assert.equal(c.recentIntervals[0].status, "short");
  assert.equal(c.recentIntervals[0].litresUsed, 120);
  assert.equal(c.recentIntervals[0].litresPerDay, null);
});

test("no reading today but earlier intervals exist", () => {
  const c = ctx([r(72, 10), r(30, 10.9)]);
  assert.equal(c.todayStatus, "no_reading_today");
  assert.equal(c.readingsSaved, 2);
  assert.equal(c.recentIntervals[0].litresUsed, 900);
});

test("meter reset and invalid drops are labelled, not counted", () => {
  const c = ctx([r(48, 900), r(30, 899), r(2, 3, { reset: true })]);
  assert.equal(c.todayStatus, "meter_reset_today");
  assert.deepEqual(c.recentIntervals.map((i) => i.status), ["reset", "negative"]);
  assert.ok(c.recentIntervals.every((i) => i.litresUsed === null && i.litresPerDay === null));
});

test("demo readings are excluded; only the last five intervals are sent, newest first", () => {
  const rs = [r(200, 1, { demo: true }), ...Array.from({ length: 8 }, (_, i) => r(24 * (8 - i), 100 + i * 0.5))];
  const c = ctx(rs);
  assert.equal(c.readingsSaved, 8);
  assert.equal(c.recentIntervals.length, 5);
  assert.ok(Date.parse(c.recentIntervals[0].to) > Date.parse(c.recentIntervals[1].to));
});

test("context JSON keeps the usage block when trimming to size", () => {
  const big = { usage: { meter: { readingsSaved: 3 } }, activityLitres: "x".repeat(5000), upcomingEvents: ["y".repeat(5000)] };
  const json = contextJSON(big, 2000);
  assert.ok(json.length <= 2000); assert.match(json, /readingsSaved/); assert.doesNotMatch(json, /xxxx/);
  assert.doesNotThrow(() => JSON.parse(json));
});

test("system prompt explains the three kinds of usage", () => {
  const p = buildSystemPrompt({ config: {}, restrictions: { stage: 4 }, context: { usage: { meter: ctx([r(96, 100), r(1, 102.4)]) } } });
  for (const s of ["ESTIMATES", "MEASURED", "NOT consumption", "Can't be determined yet", "readingsSaved > 0", "never compute consumption from a single reading", "gap_since_previous_reading", "2400"]) assert.ok(p.includes(s), s);
});
