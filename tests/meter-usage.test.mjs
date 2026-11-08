import test from "node:test";
import assert from "node:assert/strict";
import MU from "../data/meter-usage.js";

const H = 3600e3, T0 = Date.UTC(2026, 10, 1, 15); // 2026-11-01 08:00 Calgary
const dayOf = (ts) => new Date(ts - 7 * H).toISOString().slice(0, 10); // fixed MST offset is enough for tests
let n = 0;
const r = (hoursAfter, value, extra = {}) => {
  const unit = extra.unit || "m3";
  return { id: "r" + ++n, ts: T0 + hoursAfter * H, value, unit, litres: MU.toLitres(value, unit), by: "u1", ...extra };
};

test("cubic metres and cubic feet convert to litres", () => {
  assert.equal(MU.toLitres(1.5, "m3"), 1500);
  assert.ok(Math.abs(MU.toLitres(100, "ft3") - 2831.6846592) < 1e-9);
});

test("interval usage is the difference of cumulative readings, divided by elapsed days", () => {
  const ivs = MU.intervals([r(0, 100), r(72, 102.4)], { residents: 3 });
  assert.equal(ivs.length, 1);
  assert.ok(Math.abs(ivs[0].litres - 2400) < 1e-6);
  assert.ok(Math.abs(ivs[0].perDay - 800) < 1e-6);          // 2,400 L over 3 days
  assert.ok(Math.abs(ivs[0].perPerson - 800 / 3) < 1e-6);
  assert.equal(ivs[0].status, "ok");
});

test("intervals under 12 hours have no per-day rate", () => {
  const [iv] = MU.intervals([r(0, 100), r(2, 100.05)]);
  assert.equal(iv.status, "short");
  assert.equal(iv.perDay, null);
  assert.ok(Math.abs(iv.litres - 50) < 1e-6);
});

test("negative differences and meter resets are never counted as usage", () => {
  const ivs = MU.intervals([r(0, 500), r(24, 499), r(48, 3, { reset: true }), r(72, 3.6)]);
  assert.deepEqual(ivs.map((iv) => iv.status), ["negative", "reset", "ok"]);
  assert.equal(ivs[0].litres, null);
  assert.equal(ivs[1].litres, null);
  assert.ok(Math.abs(ivs[2].litres - 600) < 1e-6);
});

test("time-weighted average skips resets and needs at least 12 hours", () => {
  const avg = MU.average([r(0, 100), r(24, 100.6), r(48, 5, { reset: true }), r(96, 6)], { residents: 2 });
  // valid: 600 L / 24 h and 1,000 L / 48 h → 1,600 L over 3 days
  assert.ok(Math.abs(avg.perDay - 1600 / 3) < 1e-6);
  assert.ok(Math.abs(avg.perPerson - 800 / 3) < 1e-6);
  assert.equal(MU.average([r(0, 1), r(3, 1.01)]), null);
  assert.equal(MU.average([r(0, 1)]), null);
  assert.equal(MU.average([]), null);
});

test("a day's measured use needs a reading on the previous day", () => {
  const rs = [r(0, 100), r(24, 100.7)];
  assert.ok(Math.abs(MU.dayUse(rs, "2026-11-02", dayOf) - 700) < 1e-6);
  const gap = [r(0, 100), r(72, 102.1)]; // three days apart → not one day's use
  assert.equal(MU.dayUse(gap, "2026-11-04", dayOf), null);
  const reset = [r(0, 100), r(24, 2, { reset: true })];
  assert.equal(MU.dayUse(reset, "2026-11-02", dayOf), null);
});

test("duplicates and same-minute clashes are blocked", () => {
  const rs = [r(0, 100)];
  assert.equal(MU.checkReading(rs, r(0.05, 100))[0].code, "duplicate");
  assert.equal(MU.checkReading(rs, r(0.001, 101))[0].code, "sameTime");
  assert.deepEqual(MU.checkReading(rs, r(5, 100)), []); // same value hours later = zero use, which is real
});

test("lower readings ask for a fix or a reset; a reset reading is allowed", () => {
  const rs = [r(0, 100)];
  assert.equal(MU.checkReading(rs, r(24, 10))[0].code, "lower");
  assert.equal(MU.checkReading(rs, r(24, 10))[0].level, "needsReset");
  assert.deepEqual(MU.checkReading(rs, r(24, 10, { reset: true })), []);
});

test("big jumps scale with elapsed time; unit changes and out-of-order readings are flagged", () => {
  const rs = [r(0, 100)];
  assert.equal(MU.checkReading(rs, r(24, 106))[0].code, "bigJump");   // 6,000 L in a day
  assert.deepEqual(MU.checkReading(rs, r(24 * 10, 112)), []);          // 12,000 L over 10 days is fine
  assert.equal(MU.checkReading(rs, r(24, 3600, { unit: "ft3" })).at(-1).code, "unitChanged");
  const later = [r(0, 100), r(48, 101)];
  assert.equal(MU.checkReading(later, r(24, 102))[0].code, "higherThanNext");
});
