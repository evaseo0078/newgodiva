import calendar from "./restriction-calendar.js";

const validLitres = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
function recordDate(record, fallback) {
  return Number.isFinite(record.ts) ? calendar.dayKey(record.ts) : calendar.validDate(record.date) ? record.date : fallback;
}
export function dayUsage(date, state = {}, limit) {
  if (!calendar.validDate(date)) return null;
  const entries = Object.entries(state.logs || {}).flatMap(([key, items]) => (Array.isArray(items) ? items : [])
    .filter(entry => entry && !entry.demo && validLitres(entry.litres) && recordDate(entry, key) === date));
  const readings = (Array.isArray(state.readings) ? state.readings : []).filter(reading => reading && !reading.demo && validLitres(reading.litres))
    .map(reading => ({ ...reading, date: recordDate(reading) })).filter(reading => calendar.validDate(reading.date))
    .sort((left, right) => left.date.localeCompare(right.date) || left.ts - right.ts);
  const onDay = readings.filter(reading => reading.date === date);
  if (!entries.length && !onDay.length) return null;
  const before = readings.filter(reading => reading.date < date).at(-1);
  const previousDate = new Date(date + "T12:00:00Z");
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const consecutive = before?.date === previousDate.toISOString().slice(0, 10);
  const resetOnDay = onDay.some(reading => reading.reset); // a replaced/reset meter starts a new baseline — no daily total that day
  const difference = onDay.length && consecutive && !resetOnDay ? onDay.at(-1).litres - before.litres : null;
  const measured = difference !== null && difference >= 0;
  const used = measured ? difference : entries.length ? entries.reduce((sum, entry) => sum + entry.litres, 0) : null;
  const status = used === null ? "unavailable" : !(Number.isFinite(limit) && limit > 0) ? "unconfigured" : used <= limit ? "ok" : "over";
  return { status, used, limit, kind: measured ? "measured" : entries.length ? "logged" : "unavailable", entries, readings: onDay };
}
export function label(day) {
  return !day ? "No recorded usage" : day.status === "ok" ? "Goal met" : day.status === "over" ? "Over goal" : day.status === "unconfigured" ? "Set a household goal" : "Daily usage unavailable";
}
const householdCalendar = { dayUsage, label };
if (typeof window !== "undefined") window.DW_HOUSEHOLD_CALENDAR = householdCalendar;
export default householdCalendar;
