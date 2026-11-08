import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import model from "../data/restrictions.js";
import calendar from "../data/restriction-calendar.js";
import calendarView from "../data/calendar-presentation.js";
import timeline from "../data/restriction-timeline.js";
import calgaryTime from "../data/calgary-time.js";
import householdCalendar from "../data/household-calendar.js";
import { readHTML, extractAnnouncements } from "../lib/announcement-extraction.mjs";
import { november } from "./fixtures/restriction-scenarios.js";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const statusCode = app.slice(app.indexOf("  let restrictionStatus"), app.indexOf('  document.addEventListener("click", (e) => { const p = $("#statusPill")'));
const rulesCode = app.match(/  function renderRules\(\) \{[\s\S]*?\n  \}/)[0];
function render(snapshot, withCalendar = false) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { textContent: "", innerHTML: "", dataset: {}, classList: { toggle() {}, remove() {}, add() {} }, addEventListener() {}, querySelectorAll: () => [], querySelector: () => ({ addEventListener() {}, setAttribute() {} }) });
    return elements.get(selector);
  };
  const context = vm.createContext({ readJSON: key => key === "dw_restriction_history_v1" ? { records: [november] } : snapshot, window: { DW_RESTRICTIONS: model, DW_CALGARY_TIME: calgaryTime, DW_HOUSEHOLD_CALENDAR: householdCalendar, DW_TIMELINE: timeline, DW_CALENDAR: withCalendar ? calendar : undefined, DW_CALENDAR_VIEW: calendarView }, C: { events: [] },
    $: element, esc: value => String(value), TZ: "America/Edmonton", dateKey: date => calendar.dayKey(date), todayKey: () => "2026-11-08" });
  vm.runInContext(statusCode + rulesCode + "\nrenderStatus(); renderRules();", context);
  return { elements, context };
}

for (const stage of [0, 1, 2, 3, 4]) test(`banner, popup, rules, fine and calendar render status ${stage}`, () => {
  const snapshot = { stage, verifiedAt: new Date().toISOString(), sources: ["https://www.calgary.ca/water/drought.html"] };
  const { elements, context } = render(snapshot);
  assert.match(elements.get("#statusPill").innerHTML, new RegExp(model.stages[stage].label));
  assert.match(elements.get("#statusPill").innerHTML, /stageTip/);
  assert.equal(elements.get("#rulesTitle").textContent, model.stages[stage].label + " at a glance");
  assert.equal(elements.get("#fineChip").textContent, model.stages[stage].fine);
  assert.match(elements.get("#rulesYes").innerHTML, /<li>/);
  const events = vm.runInContext("restrictionEvents()", context);
  assert.equal(events[0].start, events[0].end);
  assert.match(events[0].title, new RegExp(model.stages[stage].label));
  assert.equal(events[0].type, stage ? "restriction" : "info");
});

test("browser cached status starts stale and shows its original verification time", () => {
  const { elements } = render({ stage: 2, verifiedAt: "2026-01-01T12:00:00Z", sources: ["https://www.calgary.ca/water/drought.html"] });
  assert.match(elements.get("#restrictionVerification").innerHTML, /STALE/);
  assert.match(elements.get("#restrictionVerification").innerHTML, /2026/);
});

test("no cache or invalid cache shows unknown with no Stage 4 rules", () => {
  for (const snapshot of [null, { stage: 4 }]) {
    const { elements } = render(snapshot);
    assert.match(elements.get("#rulesTitle").textContent, /Status unavailable/);
    assert.equal(elements.get("#rulesYes").innerHTML, "");
    assert.doesNotMatch(elements.get("#fineChip").textContent, /3,000/);
  }
});

test("an older server snapshot cannot replace a more recently verified browser stage", async () => {
  const snapshot = { stage: 0, verifiedAt: new Date().toISOString(), sources: ["https://www.calgary.ca/water/drought.html"] };
  const { context } = render(snapshot);
  context.fetch = async () => ({ json: async () => ({ ...snapshot, stage: 4, verifiedAt: "2026-01-01T00:00:00Z", stale: true }) });
  context.AbortSignal = AbortSignal;
  context.renderCalendar = () => {};
  await vm.runInContext("refreshRestrictions()", context);
  assert.equal(vm.runInContext("restrictionStatus.stage", context), 0);
  assert.equal(vm.runInContext("restrictionStatus.stale", context), true);
});

test("browsing all five guide stages leaves the banner and current rules unchanged", () => {
  const { context, elements } = render({ stage: 4, verifiedAt: new Date().toISOString(), sources: ["https://www.calgary.ca/water/drought.html"] });
  for (const stage of [0, 1, 2, 3, 4]) {
    vm.runInContext(`guideStage = ${stage}; renderStageGuide();`, context);
    assert.match(elements.get("#stageGuideBody").innerHTML, new RegExp(model.stages[stage].label + " guide"));
    assert.equal(vm.runInContext("restrictionStatus.stage", context), 4);
    assert.equal(elements.get("#rulesTitle").textContent, "Stage 4 at a glance");
  }
});

test("cards show 3–5 highlights while complete rules and exceptions remain expandable", () => {
  for (const stage of [0, 1, 2, 3, 4]) {
    const { elements } = render({ stage, verifiedAt: new Date().toISOString(), sources: ["https://www.calgary.ca/water/drought.html"] });
    const count = ["#rulesNo", "#rulesYes", "#rulesHome"].reduce((sum, key) => sum + (elements.get(key).innerHTML.match(/<li>/g) || []).length, 0);
    assert.ok(count >= 3 && count <= 5);
    const details = elements.get("#rulesDetails").innerHTML;
    for (const text of [...model.stages[stage].allowed, ...model.stages[stage].notAllowed, ...model.stages[stage].exceptions]) assert.ok(details.includes(text));
    assert.match(details, /<details>/);
    assert.match(elements.get("#fineExplanation").textContent, /prohibited activity/);
  }
});

function mountCalendar(snapshot) {
  const { context, elements } = render(snapshot, true);
  context.LOCALE = { en: "en-CA" };
  context.lang = "en";
  context.dayTotal = () => 0;
  context.budget = () => 0;
  context.dayEntries = () => [];
  context.S = { readings: [] };
  context.niceDate = key => key;
  context.firstName = identifier => identifier || "Guest";
  context.fmtL = value => String(value) + " L";
  context.t = key => key;
  context.C.events.push({ title: "Tentative construction", type: "construction", start: "2026-11-14", end: "2026-11-23", approx: true, source: "https://www.calgary.ca/", detail: "Construction estimate" });
  const calendarCode = app.slice(app.indexOf('  let calCursor ='), app.indexOf('  $("#calendar").addEventListener'));
  const moveCode = app.match(/  function moveMonth\(dir\) \{[\s\S]*?\n  \}/)[0];
  vm.runInContext(calendarCode + '\nconst calEl = $("#calendar");\n' + moveCode + '\nrenderCalendar();', context);
  return { context, elements };
}

test("actual calendar rendering preserves construction, unknown history and month/year navigation", () => {
  const { context, elements } = mountCalendar(null);
  assert.equal((elements.get("#calendar").innerHTML.match(/role="gridcell"/g) || []).length, 42);
  assert.equal(elements.get("#calendar").dataset.view, "restrictions");
  assert.doesNotMatch(elements.get("#calendar").innerHTML, /tentative construction/);
  const calendarHtml = elements.get("#calendar").innerHTML;
  for (const date of ["2026-11-04", "2026-11-07", "2026-11-14", "2026-11-30", "2026-12-01"]) {
    const cell = calendarHtml.split(`data-day="${date}"`)[1]?.split("</button>")[0];
    assert.ok(cell?.includes('data-period="2026-november-stage4"'));
    assert.ok(cell.includes(`data-certainty="${date <= "2026-11-07" ? "confirmed" : "estimated"}"`));
  }
  assert.match(elements.get("#calendarOutlook").innerHTML, /Official start: Nov 4, 2026/);
  assert.match(elements.get("#calendarOutlook").innerHTML, /four weeks; no official end date confirmed/);
  assert.doesNotMatch(calendarHtml, /class="construction-track"/);
  assert.doesNotMatch(elements.get("#calendarLegend").innerHTML, /Goal met|Construction|Officially scheduled|Confirmed No Restrictions/);
  vm.runInContext('selectedDay = "2026-11-14"; renderCalDetail();', context);
  assert.match(elements.get("#calDetail").innerHTML, /Expected Stage 4 period/);
  assert.match(elements.get("#calDetail").innerHTML, /not confirmed/);
  assert.match(elements.get("#calDetail").innerHTML, /class="cal-sources"/);
  assert.doesNotMatch(elements.get("#calDetail").innerHTML, /effective start and end dates are not inferred|verifiedThrough|open-ended declaration/i);
  assert.doesNotMatch(elements.get("#calDetail").innerHTML, /Tentative construction/);
  vm.runInContext('setCalendarView("construction");', context);
  assert.match(elements.get("#calDetail").innerHTML, /Tentative construction/);
  assert.match(elements.get("#calendar").innerHTML, /construction-band/);
  assert.doesNotMatch(elements.get("#calendar").innerHTML, /period-band/);
  vm.runInContext('setCalendarView("restrictions");', context);
  vm.runInContext('calCursor = "2026-12-01"; moveMonth(1);', context);
  assert.match(elements.get("#calMonth").textContent, /2027/);
  vm.runInContext('calCursor = "2026-01-01"; moveMonth(-1);', context);
  assert.match(elements.get("#calMonth").textContent, /2025/);
  vm.runInContext('selectedDay = "2026-04-03"; renderCalDetail();', context);
  assert.match(elements.get("#calDetail").innerHTML, /Historical data unavailable/);
});

test("a current-stage refresh saves history without deleting earlier browser observations", async () => {
  const first = { stage: 4, verifiedAt: new Date(Date.now() - 2 * 86400000).toISOString(), sources: ["https://www.calgary.ca/water/drought.html"], stale: false };
  const next = { ...first, stage: 2, verifiedAt: new Date().toISOString() };
  const { context } = render(first, true);
  context.firstSnapshot = { ...first, stale: false };
  vm.runInContext("historyRecords = [historyCalendar.observation(firstSnapshot)];", context);
  context.fetch = async () => ({ json: async () => next });
  context.AbortSignal = AbortSignal;
  let saved;
  context.localStorage = { setItem: (key, value) => { if (key === "dw_restriction_history_v1") saved = JSON.parse(value); } };
  context.renderCalendar = () => {};
  await vm.runInContext("refreshRestrictions()", context);
  assert.equal(vm.runInContext("restrictionStatus.stage", context), 2);
  assert.ok(saved.records.some(record => record.stage === 4 && record.start === calendar.dayKey(first.verifiedAt)));
  assert.ok(saved.records.some(record => record.stage === 2 && record.start === calendar.dayKey(next.verifiedAt)));
});

test("the current summary remains visible while future calendars stay bounded by announcements", () => {
  const { context, elements } = mountCalendar({ stage: 4, verifiedAt: new Date().toISOString(), sources: ["https://www.calgary.ca/water/drought.html"] });
  vm.runInContext('restrictionStatus.stale = false; renderCalendar(); selectedDay = "2026-11-09"; renderCalDetail();', context);
  const cell = elements.get("#calendar").innerHTML.split('data-day="2026-11-09"')[1].split("</button>")[0];
  assert.match(cell, /data-certainty="estimated"/);
  assert.doesNotMatch(cell, /data-certainty="confirmed"|data-certainty="active"/);
  assert.match(elements.get("#calDetail").innerHTML, /not confirmed/);
  assert.match(elements.get("#currentRestrictionSummary").innerHTML, /Stage 4/);
  assert.match(elements.get("#currentRestrictionSummary").innerHTML, /until the City announces a change/);
  assert.match(elements.get("#currentRestrictionSummary").innerHTML, /End date unknown/);
  assert.match(elements.get("#calendarLegend").innerHTML, /Current verified stage|Confirmed history/);
  assert.doesNotMatch(elements.get("#calendarLegend").innerHTML, /Officially scheduled|No Restrictions|Goal met|Construction/);
  assert.match(elements.get("#calendarOutlook").innerHTML, /Official announcement/);
  assert.match(elements.get("#calDetail").innerHTML, /Declaration-Stage-4-Water-Restrictions-Nov-4-2026\.pdf/);
  vm.runInContext('calCursor = "2026-12-01"; moveMonth(1);', context);
  assert.match(elements.get("#calMonth").textContent, /2027/);
  assert.doesNotMatch(elements.get("#calendar").innerHTML, /data-certainty="active"|data-certainty="estimated"/);
  assert.match(elements.get("#currentRestrictionSummary").innerHTML, /Stage 4/);
  vm.runInContext('selectedDay = "2027-01-09"; renderCalDetail();', context);
  assert.match(elements.get("#calDetail").innerHTML, /No official restriction announcement/);
  vm.runInContext('selectedDay = "2026-05-01"; renderCalDetail();', context);
  assert.match(elements.get("#calDetail").innerHTML, /Historical data unavailable/);
});

test("calendar view filters preserve selected dates and show only their own content and legend", () => {
  const { context, elements } = mountCalendar(null);
  context.S.logs = { "2026-11-05": [{ litres: 100, by: "guest" }], "2026-11-06": [{ litres: 400, by: "guest" }] };
  context.budget = () => 300;
  context.t = key => key;
  context.isMeasured = () => false;
  context.fmtL = value => String(value) + " L";
  vm.runInContext('selectedDay = "2026-11-05"; setCalendarView("goals");', context);
  assert.equal(elements.get("#calendar").dataset.view, "goals");
  assert.match(elements.get("#calendarLegend").innerHTML, /Goal met|Over goal/);
  assert.doesNotMatch(elements.get("#calendar").innerHTML, /period-band|construction-band/);
  assert.match(elements.get("#calDetail").innerHTML, /Household goal met/);
  assert.doesNotMatch(elements.get("#calendarLegend").innerHTML, /restriction|scheduled|Construction/);
  vm.runInContext('selectedDay = "2026-11-14"; setCalendarView("construction");', context);
  assert.match(elements.get("#calendarLegend").innerHTML, /Tentative construction dates/);
  assert.doesNotMatch(elements.get("#calendarLegend").innerHTML, /Active order|Goal met|Unknown/);
  assert.match(elements.get("#calDetail").innerHTML, /Construction notice/);
  vm.runInContext('setCalendarView("restrictions");', context);
  assert.equal(vm.runInContext("selectedDay", context), "2026-11-14");
  assert.equal(elements.get("#calendar").dataset.view, "restrictions");
  assert.doesNotMatch(elements.get("#calendarLegend").innerHTML, /Goal met|Construction/);
  vm.runInContext('setCalendarView("invalid");', context);
  assert.equal(elements.get("#calendar").dataset.view, "restrictions");
});

test("the rendered current summary uses the preserved declaration clock and current Alberta timezone rules", () => {
  const stamp = new Date().toISOString();
  const announcement = { id: "legacy-start", revision: "legacy-revision", kind: "declaration", stage: 4, effectiveDate: "2026-11-04", effectiveAt: "2026-11-04T07:01:00Z", effectiveTime: "00:01", source: "https://www.calgary.ca/water/drought.html", verifiedAt: stamp };
  const { elements } = mountCalendar({ stage: 4, effectiveFrom: announcement.effectiveAt, effectiveDate: announcement.effectiveDate, announcements: [announcement], verifiedAt: stamp, sources: [announcement.source] });
  assert.match(elements.get("#currentRestrictionSummary").innerHTML, /12:01.*a\.m\..*ABT/);
  assert.doesNotMatch(elements.get("#currentRestrictionSummary").innerHTML, /1:01 a\.m\./);
});

test("an extracted leap-year Stage 2 timeline renders across months without date-specific UI code", async () => {
  const checked = "2028-02-28T18:00:00Z";
  const source = "https://newsroom.calgary.ca/synthetic-stage-two/";
  const announcements = extractAnnouncements(readHTML("<article>Stage 2 water restrictions begin February 26, 2028 at 6:00 am for approximately ten days.</article>", source, checked)).announcements;
  const snapshot = { stage: 2, verifiedAt: checked, stale: false, timezoneVersion: calgaryTime.version, announcements, sources: [source], effectiveFrom: announcements[0].effectiveAt, expectedDuration: announcements[0].duration.text };
  snapshot.history = { records: timeline.buildTimeline(announcements, { currentStatus: snapshot }).records };
  const { context, elements } = mountCalendar(null);
  context.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [checked])); } static now() { return Date.parse(checked); } };
  context.todayKey = () => "2028-02-28";
  context.fetch = async () => ({ json: async () => snapshot });
  context.AbortSignal = AbortSignal;
  await vm.runInContext('calCursor = "2028-02-01"; refreshRestrictions();', context);
  assert.match(elements.get("#currentRestrictionSummary").innerHTML, /Stage 2.*|Feb 26, 2028/);
  for (const date of ["2028-02-26", "2028-02-29", "2028-03-01"]) assert.ok(elements.get("#calendar").innerHTML.split(`data-day="${date}"`)[1].split("</button>")[0].includes('data-period="phase:2:2028-02-26"'));
  vm.runInContext('moveMonth(1);', context);
  assert.match(elements.get("#calMonth").textContent, /March 2028/);
  assert.match(elements.get("#calendar").innerHTML.split('data-day="2028-03-06"')[1].split("</button>")[0], /data-certainty="estimated"/);
  assert.doesNotMatch(elements.get("#calendar").innerHTML.split('data-day="2028-03-07"')[1].split("</button>")[0], /period-band/);
});

test("all three views retain their own data and selection when navigating December and January", () => {
  const { context, elements } = mountCalendar(null);
  context.S = { logs: { "2027-01-01": [{ litres: 400, by: "guest" }] }, readings: [] };
  context.budget = () => 300;
  context.C.events.push({ type: "construction", title: "Year crossing work", start: "2026-12-31", end: "2027-01-02", approx: true, source: "https://www.calgary.ca/" });
  for (const mode of ["restrictions", "goals", "construction"]) {
    context.selectedMode = mode;
    vm.runInContext('calCursor = "2026-12-01"; setCalendarView(selectedMode); moveMonth(1);', context);
    assert.equal(elements.get("#calendar").dataset.view, mode);
    assert.match(elements.get("#calMonth").textContent, /January 2027/);
    assert.equal(vm.runInContext("selectedDay", context), "2027-01-01");
    if (mode === "goals") assert.match(elements.get("#calDetail").innerHTML, /Over household goal/);
    if (mode === "construction") assert.match(elements.get("#calDetail").innerHTML, /Year crossing work/);
    if (mode === "restrictions") assert.doesNotMatch(elements.get("#calendar").innerHTML, /Year crossing work|cal-goal-status/);
    vm.runInContext('moveMonth(-1);', context);
    assert.match(elements.get("#calMonth").textContent, /December 2026/);
    assert.equal(elements.get("#calendar").dataset.view, mode);
  }
});
