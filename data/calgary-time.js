export const timezone = "America/Edmonton";
export const version = "iana-2026f-alberta";
export const sources = ["https://www.alberta.ca/albertas-new-time-system-abt", "https://data.iana.org/time-zones/tzdb-2026f/northamerica"];
const albertaTimeBegins = Date.parse("2026-11-01T08:00:00Z");
const formatters = new Map();
function instant(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isFinite(+date) ? date : null;
}
function formatter(value, locale, options) {
  const selectedZone = +value >= albertaTimeBegins ? "Etc/GMT+6" : timezone;
  const key = JSON.stringify([locale, selectedZone, options]);
  if (!formatters.has(key)) {
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value);
    formatters.set(key, new Intl.DateTimeFormat(locale, { ...options, timeZone: selectedZone }));
  }
  return formatters.get(key);
}
export function parts(value, options = {}, locale = "en-CA") {
  const date = instant(value);
  if (!date) return [];
  return formatter(date, locale, options).formatToParts(date).map(part =>
    part.type === "timeZoneName" && +date >= albertaTimeBegins ? { ...part, value: "ABT" } : part);
}
export function format(value, options = {}, locale = "en-CA") {
  return parts(value, options, locale).map(part => part.value).join("");
}
export function dayKey(value = new Date()) {
  const values = Object.fromEntries(parts(value, { year: "numeric", month: "2-digit", day: "2-digit" }).map(part => [part.type, part.value]));
  return values.year ? `${values.year}-${values.month}-${values.day}` : null;
}
export function localInstant(date, hour, minute = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const target = Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) return null;
  const wall = stamp => {
    const values = Object.fromEntries(parts(stamp, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).map(part => [part.type, part.value]));
    return Date.parse(`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:00Z`);
  };
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) guess += target - wall(guess);
  if (wall(guess) !== target || wall(guess - 3600000) === target || wall(guess + 3600000) === target) return null;
  return new Date(guess).toISOString();
}
const calgaryTime = { timezone, version, sources, format, parts, dayKey, localInstant };
if (typeof window !== "undefined") window.DW_CALGARY_TIME = calgaryTime;
export default calgaryTime;
