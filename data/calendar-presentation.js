import calendar from "./restriction-calendar.js";
import calgaryTime from "./calgary-time.js";
import { addDays, parseDuration, estimateWindow } from "./restriction-timeline.js";

const stageLabel = stage => stage ? `Stage ${stage}` : "No Restrictions";
const viewModes = ["restrictions", "goals", "construction"];
function activeDeclaration(history = [], options = {}) {
  const current = options.currentStatus, today = options.today || calendar.dayKey();
  if (!current || !Number.isInteger(current.stage) || current.stage < 1 || current.stage > 4 ||
    !Number.isFinite(Date.parse(current.verifiedAt)) || options.conflict || current.verificationIssue === "conflict") return null;
  const verifiedDay = calendar.dayKey(current.verifiedAt);
  const records = calendar.mergeRecords(history);
  return records.filter(record => record.kind === "declaration" && record.status === "confirmed" && record.end === null &&
    record.stage === current.stage && record.start <= today && record.start <= verifiedDay &&
    !records.some(other => other.status === "confirmed" && other.stage !== record.stage && other.start > record.start && other.start <= today))
    .sort((left, right) => right.start.localeCompare(left.start))[0] || null;
}
function dateLabel(date) {
  return calendar.validDate(date) ? new Date(date + "T12:00:00Z").toLocaleDateString("en-CA", {
    timeZone: calendar.timezone, month: "short", day: "numeric", year: "numeric"
  }) : "Date unavailable";
}
function periodRange(record, history = [], options = {}) {
  if (!calendar.validRecord(record) || record.kind === "observation" || record.status === "unknown") return null;
  const confirmedThrough = record.status === "scheduled" ? record.end || record.start : record.end || record.verifiedThrough || calendar.dayKey(record.verifiedAt);
  const estimate = record.estimate || estimateWindow(record.start, record.duration || parseDuration(record.expectedDuration || ""));
  const derivedEnd = estimate?.latest;
  let displayThrough = record.end || record.estimatedThrough || derivedEnd || confirmedThrough;
  if (displayThrough < record.start) displayThrough = record.start;
  if (!record.end) {
    const change = calendar.mergeRecords(history).find(other => other.stage !== record.stage && other.status === "confirmed" &&
      other.start > confirmedThrough && other.start <= displayThrough);
    if (change) displayThrough = addDays(change.start, -1);
    const current = options.currentStatus, verifiedDay = current && Number.isFinite(Date.parse(current.verifiedAt)) ? calendar.dayKey(current.verifiedAt) : null;
    if (current && Number.isInteger(current.stage) && current.stage >= 0 && current.stage <= 4 && current.stage !== record.stage &&
      verifiedDay > confirmedThrough && verifiedDay <= displayThrough) displayThrough = addDays(verifiedDay, -1);
  }
  const active = activeDeclaration(history, options)?.id === record.id;
  const announcedChange = active ? calendar.mergeRecords(history).find(other => other.stage !== record.stage &&
    ["scheduled", "confirmed"].includes(other.status) && other.kind !== "observation" && other.start > (options.today || calendar.dayKey())) : null;
  const verifiedDay = active ? calendar.dayKey(options.currentStatus.verifiedAt) : null;
  if (active && !options.currentStatus.stale && verifiedDay > displayThrough) displayThrough = verifiedDay;
  if (announcedChange && announcedChange.start <= displayThrough) displayThrough = addDays(announcedChange.start, -1);
  return { record, start: record.start, confirmedThrough, displayThrough, active, announcedChange, estimate,
    derivedEstimate: !record.end && !record.estimatedThrough && !!derivedEnd };
}
function periodsForDay(date, history = [], options = {}) {
  if (!calendar.validDate(date)) return [];
  const today = options.today || calendar.dayKey();
  const records = calendar.mergeRecords(history);
  const state = calendar.resolveDay(date, records, options);
  const periods = records.flatMap(record => {
    const range = periodRange(record, records, options);
    if (!range || date < range.start || range.displayThrough && date > range.displayThrough) return [];
    if (range.active && date === today && !options.currentStatus?.stale && calendar.dayKey(options.currentStatus.verifiedAt) === today) return [{ ...range, id: record.id, stage: record.stage, status: "active", projected: false,
      label: `${stageLabel(record.stage)} · current check`, independentlyVerified: true,
      stale: !!options.stale || !!options.currentStatus?.stale, observedOnly: false }];
    const historicalRange = range.active ? periodRange(record, records) : range;
    if (date > historicalRange.displayThrough) return [];
    const observed = state.records.find(other => other.kind === "observation" && other.stage === record.stage);
    const projected = !observed && date > range.confirmedThrough;
    const status = state.status === "conflict" ? "conflict" : record.status === "estimated" || projected ? "estimated" :
      record.status === "scheduled" || date > today ? "scheduled" : "confirmed";
    return [{ ...range, displayThrough: historicalRange.displayThrough, id: record.id, stage: record.stage, status, projected, independentlyVerified: date <= today && !projected,
      label: `${stageLabel(record.stage)}${status === "estimated" ? " · estimate" : status === "scheduled" ? " · scheduled" : status === "conflict" ? " · unclear" : ""}`,
      stale: state.stale, observedOnly: !!observed && date > range.confirmedThrough }];
  });
  for (const record of state.records.filter(record => record.kind === "observation")) {
    if (periods.some(period => period.stage === record.stage)) continue;
    periods.push({ id: record.id, record, start: record.start, displayThrough: record.start, stage: record.stage,
      status: state.status === "conflict" ? "conflict" : state.status === "scheduled" ? "scheduled" : "confirmed", label: `${stageLabel(record.stage)} · reported`, observedOnly: true, stale: state.stale });
  }
  return periods;
}
function describeDay(date, history = [], options = {}) {
  const today = options.today || calendar.dayKey();
  const state = calendar.resolveDay(date, history, options);
  const periods = periodsForDay(date, history, options);
  const period = periods.find(period => !period.observedOnly) || periods[0];
  const records = calendar.mergeRecords(state.records, periods.map(period => period.record));
  let title = state.message, lines = [];
  const active = periods.find(period => period.status === "active");
  if (active) {
    title = `${stageLabel(active.stage)} · ${active.stale ? "last known active order" : "active order"}`;
    lines = ["No officially confirmed end date. Follow this restriction until the City announces a change.",
      date > today ? "This date shows the current order, not a separately verified future status." : `In effect from ${dateLabel(active.start)}.`];
  } else if (state.status === "conflict") {
    title = "Restriction status unclear";
    lines = ["Official updates disagree. Check with the City before using water outdoors."];
  } else if (state.status === "transition") {
    title = "Restrictions changed on this date";
    lines = state.records.map(record => {
      const time = record.endsAt || record.startsAt;
      const clock = time ? calgaryTime.format(time, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "";
      return `${stageLabel(record.stage)}${clock ? ` ${record.endsAt ? "until" : "from"} ${clock} Calgary time` : " was reported"}.`;
    });
  } else if (state.stage !== null) {
    title = `${stageLabel(state.stage)}${state.status === "scheduled" ? " · scheduled" : state.status === "estimated" ? " · estimate" : " · confirmed"}`;
    if (period && !period.observedOnly) {
      lines.push(`${period.record.status === "estimated" ? "Estimated start:" : period.status === "scheduled" ? "Starts" : "Started"} ${dateLabel(period.start)}.`);
      lines.push(period.record.end ? `${period.record.end > today ? "Announced end:" : "Ended"} ${dateLabel(period.record.end)}.` : period.record.expectedDuration || "No end date has been confirmed.");
    } else lines.push("Reported on this date only.");
  } else if (period?.status === "estimated") {
    title = date > today ? `Expected ${stageLabel(period.stage)} period` : "Historical data unavailable";
    lines = [period.record.expectedDuration || "This date falls within an estimated restriction period.",
      "The stage on this date is not confirmed. Stripes show an estimate only."];
  } else if (state.status === "unknown" && calendar.validDate(date)) {
    title = date > today ? "No official restriction announcement for this date" : "Historical data unavailable";
  }
  if (state.stale || active?.stale || options.currentStatus?.stale) lines.push("The last confirmed update may be out of date. Check the City for changes.");
  return { title, lines, records, periods, state, displayStatus: active ? "active" : state.status };
}

function filterDay(day, mode = "restrictions") {
  const selected = viewModes.includes(mode) ? mode : "restrictions";
  return { periods: selected === "restrictions" ? day.periods || [] : [],
    construction: selected === "construction" ? day.construction || [] : [],
    goal: selected === "goals" ? day.goal || null : null };
}
function legendForView(mode, days = []) {
  const items = new Map();
  const add = (id, label, style) => items.set(id, { id, label, style });
  for (const day of days) {
    if (mode === "goals") {
      if (day.goal) add(day.goal.status, day.goal.status === "ok" ? "Goal met" : day.goal.status === "over" ? "Over goal" : day.goal.status === "unconfigured" ? "Set a household goal" : "Daily usage unavailable", ["ok", "over"].includes(day.goal.status) ? "goal-" + day.goal.status : "unknown");
      else add("unrecorded", "No recorded usage", "unknown");
    } else if (mode === "construction") {
      for (const event of day.construction || []) add(event.approx ? "tentative" : "announced", event.approx ? "Tentative construction dates" : "Announced construction dates", "construction");
    } else {
      for (const period of day.periods || []) {
        if (period.status === "active") add("active", "Current verified stage", "active");
        else if (period.status === "scheduled") add("scheduled", "Officially scheduled", "scheduled");
        else if (period.status === "estimated") add("estimated", "Duration estimate only", "estimate");
        else if (period.status === "conflict") add("conflict", "Updates unclear", "unknown");
        else if (period.stage === 0) add("no-restrictions", "Confirmed No Restrictions", "info");
        else add("confirmed", "Confirmed history", "restriction");
      }
      if (day.state?.status === "unknown" && !(day.periods || []).some(period => period.status === "active")) add("unknown", "Unknown", "unknown");
    }
  }
  const order = ["active", "confirmed", "estimated", "scheduled", "no-restrictions", "conflict", "unknown", "ok", "over", "unavailable", "unconfigured", "unrecorded", "announced", "tentative"];
  return [...items.values()].sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
}
const presentation = { periodRange, periodsForDay, describeDay, dateLabel, activeDeclaration, viewModes, filterDay, legendForView };
if (typeof window !== "undefined") window.DW_CALENDAR_VIEW = presentation;
export default presentation;
