import test from "node:test";
import assert from "node:assert/strict";
import calendar from "../data/restriction-calendar.js";
import view from "../data/calendar-presentation.js";
import { november } from "./fixtures/restriction-scenarios.js";

const options = { today: "2026-11-08" };

test("November shows a continuous solid and estimated span without assigning an official end", () => {
  const before = JSON.stringify(november);
  for (let offset = 0; offset < 28; offset++) {
    const date = new Date("2026-11-04T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + offset);
    const key = date.toISOString().slice(0, 10);
    const periods = view.periodsForDay(key, [november], options);
    assert.equal(periods.length, 1);
    assert.equal(periods[0].id, november.id);
    assert.equal(periods[0].status, key <= "2026-11-07" ? "confirmed" : "estimated");
  }
  assert.deepEqual(view.periodsForDay("2026-11-03", [november], options), []);
  assert.deepEqual(view.periodsForDay("2026-12-02", [november], options), []);
  assert.equal(november.end, null);
  assert.equal(JSON.stringify(november), before);
  assert.equal(calendar.resolveDay("2026-12-01", [november], options).stage, null);
});

test("estimated band continues through adjacent month grids with a stable period identifier", () => {
  for (const month of ["2026-11-01", "2026-12-01"]) {
    const visible = calendar.monthGrid(month).filter(day => day.key >= "2026-11-29" && day.key <= "2026-12-01");
    assert.equal(visible.length, 3);
    for (const day of visible) {
      const period = view.periodsForDay(day.key, [november], options)[0];
      assert.equal(period.id, november.id);
      assert.equal(period.status, "estimated");
    }
  }
});

test("confirmed periods continue across month and year boundaries without becoming estimates", () => {
  const record = { ...november, id: "winter-confirmed", start: "2026-12-29", end: "2027-01-03", expectedDuration: undefined, verifiedThrough: undefined };
  for (const date of ["2026-12-31", "2027-01-01"]) assert.equal(view.periodsForDay(date, [record], { today: "2027-01-10" })[0].status, "confirmed");
  assert.deepEqual(view.periodsForDay("2027-01-04", [record]), []);
});

test("announced future dates have scheduled styling, independent of estimated continuation", () => {
  const record = { ...november, id: "scheduled", status: "scheduled", start: "2026-12-10", end: "2026-12-12", verifiedThrough: undefined };
  assert.equal(view.periodsForDay("2026-12-11", [record], options)[0].status, "scheduled");
  const startOnly = { ...record, end: null, expectedDuration: undefined, verifiedThrough: undefined };
  assert.equal(view.periodsForDay("2026-12-10", [startOnly], options)[0].status, "scheduled");
  assert.deepEqual(view.periodsForDay("2026-12-11", [startOnly], options), []);
});

test("an isolated observation is never expanded into a continuous restriction range", () => {
  const observation = calendar.observation({ stage: 4, verifiedAt: "2026-11-10T15:00:00Z", sources: [november.source] });
  assert.equal(view.periodsForDay("2026-11-10", [observation], options).length, 1);
  assert.equal(view.periodsForDay("2026-11-09", [observation], options).length, 0);
  assert.equal(view.periodsForDay("2026-11-11", [observation], options).length, 0);
});

test("later differing stages stop the display estimate without inventing an official end", () => {
  const change = calendar.observation({ stage: 0, verifiedAt: "2026-11-15T15:00:00Z", sources: [november.source] });
  const history = [november, change];
  assert.equal(view.periodsForDay("2026-11-14", history, { today: "2026-11-20" })[0].status, "estimated");
  assert.equal(view.periodsForDay("2026-11-15", history, { today: "2026-11-20" })[0].stage, 0);
  assert.deepEqual(view.periodsForDay("2026-11-16", history, { today: "2026-11-20" }), []);
  assert.equal(november.end, null);
});

test("observations matching an expected period confirm only their recorded day", () => {
  const observation = calendar.observation({ stage: 4, verifiedAt: "2026-11-10T15:00:00Z", sources: [november.source] });
  const history = [november, observation];
  assert.equal(view.periodsForDay("2026-11-10", history, { today: "2026-11-10" })[0].status, "confirmed");
  assert.equal(view.periodsForDay("2026-11-09", history, { today: "2026-11-10" })[0].status, "estimated");
});

test("short summaries retain approximate duration, unknown end and accessible source records", () => {
  const summary = view.describeDay("2026-11-05", [november], options);
  assert.match(summary.title, /Stage 4/);
  assert.ok(summary.lines.length <= 3);
  assert.match(summary.lines.join(" "), /Nov 4, 2026/);
  assert.match(summary.lines.join(" "), /four weeks/);
  assert.match(summary.lines.join(" "), /no official end date confirmed/i);
  assert.equal(summary.records[0].source, november.source);
  assert.doesNotMatch(summary.lines.join(" "), /verifiedThrough|snapshot|effective start and end dates are not inferred/i);
  const forecast = view.describeDay("2026-11-20", [november], options);
  assert.match(forecast.title, /Expected Stage 4/);
  assert.match(forecast.lines.join(" "), /not confirmed/);
});

test("genuinely missing history is unavailable, while confirmed stage zero remains distinct", () => {
  assert.equal(view.describeDay("2026-05-01", calendar.records, options).title, "Historical data unavailable");
  assert.equal(view.describeDay("2026-11-12", [november], { today: "2026-11-20" }).title, "Historical data unavailable");
  assert.match(view.describeDay("2026-04-02", calendar.records.filter(record => record.stage === 0), options).title, /No Restrictions/);
  assert.deepEqual(view.periodsForDay("bad", calendar.records), []);
});

test("intraday changes and conflicts stay explicit in the short summaries", () => {
  const transition = view.describeDay("2026-04-02", calendar.records, options);
  assert.match(transition.title, /changed/);
  assert.match(transition.lines.join(" "), /9:00/);
  const conflict = view.describeDay("2026-11-08", [november], { ...options, conflict: true });
  assert.match(conflict.title, /unclear/);
  assert.equal(conflict.periods[0].status, "conflict");
});

test("open declarations without an expected duration do not create unlimited future bands", () => {
  const record = { ...november, expectedDuration: undefined };
  assert.equal(view.periodsForDay("2026-11-07", [record], options)[0].status, "confirmed");
  assert.deepEqual(view.periodsForDay("2026-11-08", [record], options), []);
});

const currentStatus = { stage: 4, verifiedAt: "2026-11-08T12:00:00Z", sources: [november.source], stale: false };
const activeOptions = { ...options, currentStatus };

test("current stage stays separate from bounded future estimates", () => {
  const original = JSON.stringify(november);
  const current = view.describeDay(options.today, [november], activeOptions);
  assert.equal(current.displayStatus, "active");
  assert.equal(current.periods[0].independentlyVerified, true);
  assert.match(current.lines.join(" "), /until the City announces a change/);
  const tomorrow = view.periodsForDay("2026-11-09", [november], activeOptions)[0];
  assert.equal(tomorrow.status, "estimated");
  assert.equal(tomorrow.displayThrough, "2026-12-01");
  assert.equal(tomorrow.independentlyVerified, false);
  for (const date of ["2026-12-02", "2027-01-01"]) {
    assert.deepEqual(view.periodsForDay(date, [november], activeOptions), []);
    assert.match(view.describeDay(date, [november], activeOptions).title, /No official restriction announcement/);
    assert.equal(view.activeDeclaration([november], activeOptions).stage, 4);
  }
  assert.equal(calendar.resolveDay("2026-12-02", [november], options).stage, null);
  assert.equal(JSON.stringify(november), original);
});

test("active orders do not need an estimate and do not backfill historical gaps", () => {
  const record = { ...november, verifiedThrough: "2026-11-05", expectedDuration: undefined };
  assert.deepEqual(view.periodsForDay("2027-03-01", [record], activeOptions), []);
  assert.equal(view.activeDeclaration([record], activeOptions).end, null);
  assert.equal(view.periodsForDay(options.today, [record], activeOptions)[0].status, "active");
  assert.equal(view.describeDay("2026-11-06", [record], activeOptions).title, "Historical data unavailable");
  assert.equal(view.describeDay("2026-05-01", [record], activeOptions).title, "Historical data unavailable");
});

test("stale verification never promotes a future estimate to a verified order", () => {
  const description = view.describeDay("2026-11-09", [november], { ...activeOptions, currentStatus: { ...currentStatus, stale: true } });
  assert.match(description.title, /Expected Stage 4/);
  assert.match(description.lines.join(" "), /out of date/);
  assert.equal(description.periods[0].independentlyVerified, false);
});

test("a changed verified stage or a closed declaration cannot keep the old order active", () => {
  assert.equal(view.activeDeclaration([november], { ...activeOptions, currentStatus: { ...currentStatus, stage: 0 } }), null);
  assert.equal(view.activeDeclaration([{ ...november, end: "2026-11-07" }], activeOptions), null);
  assert.equal(view.activeDeclaration([november], { ...activeOptions, currentStatus: null }), null);
  assert.equal(view.activeDeclaration([november], { ...activeOptions, conflict: true }), null);
  const changed = calendar.observation({ stage: 2, verifiedAt: "2026-11-07T12:00:00Z", sources: [november.source] });
  assert.equal(view.activeDeclaration([november, changed], activeOptions), null);
  assert.deepEqual(view.periodsForDay("2026-11-09", [november], { ...activeOptions, currentStatus: { ...currentStatus, stage: 0 } }), []);
  assert.equal(calendar.validRecord({ ...november, declarationSource: "javascript:alert(1)" }), false);
});

test("officially scheduled changes take precedence on their announced date", () => {
  const next = { ...november, id: "scheduled-next", stage: 3, start: "2026-11-20", end: "2026-11-22", status: "scheduled", verifiedThrough: undefined };
  const history = [november, next];
  assert.equal(view.periodsForDay("2026-11-19", history, activeOptions)[0].status, "estimated");
  const after = view.periodsForDay("2026-11-20", history, activeOptions);
  assert.equal(after.length, 1);
  assert.equal(after[0].stage, 3);
  assert.equal(after[0].status, "scheduled");
  assert.equal(november.end, null);
});

test("view filters keep water restrictions, household goals and construction separate", () => {
  const day = { periods: [{ status: "active", stage: 4 }], construction: [{ title: "Work", approx: true }], goal: { status: "ok" } };
  assert.deepEqual(view.filterDay(day), { periods: day.periods, construction: [], goal: null });
  assert.deepEqual(view.filterDay(day, "goals"), { periods: [], construction: [], goal: day.goal });
  assert.deepEqual(view.filterDay(day, "construction"), { periods: [], construction: day.construction, goal: null });
  assert.deepEqual(view.filterDay(day, "invalid"), view.filterDay(day));
});

test("legends contain only categories in the visible view", () => {
  const days = [{ periods: [{ status: "active", stage: 4 }], construction: [{ approx: true }], goal: { status: "ok" }, state: { status: "unknown" } }];
  assert.deepEqual(view.legendForView("restrictions", days).map(item => item.id), ["active"]);
  assert.deepEqual(view.legendForView("restrictions", [{ periods: [{ stage: 4, active: true, status: "confirmed" }] }, ...days]).map(item => item.id), ["active", "confirmed"]);
  assert.deepEqual(view.legendForView("goals", days).map(item => item.id), ["ok"]);
  assert.deepEqual(view.legendForView("construction", days).map(item => item.id), ["tentative"]);
  const extra = { periods: [{ status: "scheduled", stage: 2 }, { status: "confirmed", stage: 0 }], state: { status: "confirmed" } };
  assert.deepEqual(view.legendForView("restrictions", [extra]).map(item => item.id), ["scheduled", "no-restrictions"]);
  assert.deepEqual(view.legendForView("restrictions", [{ periods: [], state: { status: "unknown" } }]).map(item => item.id), ["unknown"]);
});

test("verified historical No Restrictions intervals do not become future or gap defaults", () => {
  const record = { ...november, id: "historical-zero", stage: 0, start: "2026-04-03", end: "2026-04-07", verifiedThrough: undefined };
  const description = view.describeDay("2026-04-05", [record], activeOptions);
  assert.equal(description.state.stage, 0);
  assert.equal(description.periods[0].status, "confirmed");
  assert.deepEqual(view.legendForView("restrictions", [description]).map(item => item.id), ["no-restrictions"]);
  assert.equal(view.describeDay("2026-04-08", [record], activeOptions).title, "Historical data unavailable");
  assert.equal(view.describeDay("2026-11-09", [record], activeOptions).state.stage, null);
});
