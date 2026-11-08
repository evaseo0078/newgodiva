import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import model from "../data/restrictions.js";
import calendar from "../data/restriction-calendar.js";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const statusCode = app.slice(app.indexOf("  let restrictionStatus"), app.indexOf('  document.addEventListener("click", (e) => { const p = $("#statusPill")'));
const rulesCode = app.match(/  function renderRules\(\) \{[\s\S]*?\n  \}/)[0];
function render(snapshot, withCalendar = false) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { textContent: "", innerHTML: "", classList: { toggle() {}, remove() {}, add() {} }, addEventListener() {}, querySelector: () => ({ addEventListener() {}, setAttribute() {} }) });
    return elements.get(selector);
  };
  const context = vm.createContext({ readJSON: key => key === "dw_restriction_history_v1" ? null : snapshot, window: { DW_RESTRICTIONS: model, DW_CALENDAR: withCalendar ? calendar : undefined }, C: { events: [] },
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

test("actual calendar rendering preserves construction, unknown history and month/year navigation", () => {
  const { context, elements } = render(null, true);
  context.LOCALE = { en: "en-CA" };
  context.lang = "en";
  context.dayTotal = () => 0;
  context.budget = () => 0;
  context.dayEntries = () => [];
  context.S = { readings: [] };
  context.niceDate = key => key;
  context.C.events.push({ title: "Tentative construction", type: "construction", start: "2026-11-14", end: "2026-11-23", approx: true, source: "https://www.calgary.ca/", detail: "Construction estimate" });
  const calendarCode = app.slice(app.indexOf('  let calCursor ='), app.indexOf('  $("#calendar").addEventListener'));
  const moveCode = app.match(/  function moveMonth\(dir\) \{[\s\S]*?\n  \}/)[0];
  vm.runInContext(calendarCode + '\nconst calEl = $("#calendar");\n' + moveCode + '\nrenderCalendar();', context);
  assert.equal((elements.get("#calendar").innerHTML.match(/role="gridcell"/g) || []).length, 42);
  assert.match(elements.get("#calendar").innerHTML, /tentative construction/);
  vm.runInContext('selectedDay = "2026-11-14"; renderCalDetail();', context);
  assert.match(elements.get("#calDetail").innerHTML, /No official restriction announcement/);
  assert.match(elements.get("#calDetail").innerHTML, /Tentative construction/);
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
