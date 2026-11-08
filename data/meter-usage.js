/* DropWise YYC — water-meter maths (pure functions, no DOM).
 * A meter shows a CUMULATIVE total. Usage is always the difference between two consecutive readings,
 * converted to litres and divided by the real time between them. Nothing here invents or fills in readings.
 *
 * Reading shape: { id, ts, value, unit: "m3"|"ft3", litres, by, date?, source?: "manual" (older rows may say "photo"/"photo-edited"), reset?: boolean }
 * `reset: true` marks the first reading after a meter was replaced or rolled over — it starts a new baseline,
 * so the interval ending at it is never counted as usage.
 */

export const L_PER = { m3: 1000, ft3: 28.316846592 };
export const MIN_RATE_HOURS = 12;              // shorter intervals are too noisy for a per-day rate (same rule as the ranking SQL)
export const DUPLICATE_WINDOW_MS = 10 * 60e3;  // same value within 10 minutes = the same reading saved twice
export const SAME_TIME_MS = 60e3;              // two different values at the same minute can't both be right
export const SOURCES = ["manual", "photo", "photo-edited"];

export const toLitres = (value, unit) => value * (L_PER[unit] || L_PER.m3);
const validReading = (r) => r && Number.isFinite(r.ts) && Number.isFinite(r.litres) && r.litres >= 0;
export const sortReadings = (readings) => (Array.isArray(readings) ? readings : []).filter(validReading).sort((a, b) => a.ts - b.ts);

/** One row per pair of consecutive readings. status: "ok" | "short" (under 12 h, no rate) | "reset" | "negative". */
export function intervals(readings, { residents = 1 } = {}) {
  const rs = sortReadings(readings), people = residents > 0 ? residents : 1, out = [];
  for (let i = 1; i < rs.length; i++) {
    const from = rs[i - 1], to = rs[i], hours = (to.ts - from.ts) / 3600e3, diff = to.litres - from.litres;
    let status = "ok";
    if (to.reset) status = "reset";
    else if (diff < 0) status = "negative";
    else if (hours < MIN_RATE_HOURS) status = "short";
    const counted = status === "ok" || status === "short";
    const perDay = status === "ok" ? diff / (hours / 24) : null;
    out.push({ from, to, hours, litres: counted ? diff : null, perDay, perPerson: perDay == null ? null : perDay / people, status });
  }
  return out;
}

/** Time-weighted average over valid intervals that END inside [sinceTs, untilTs]. Needs at least 12 h of data. */
export function average(readings, { residents = 1, sinceTs = -Infinity, untilTs = Infinity } = {}) {
  const ok = intervals(readings, { residents }).filter((iv) => iv.litres != null && iv.to.ts >= sinceTs && iv.to.ts <= untilTs);
  const hours = ok.reduce((s, iv) => s + iv.hours, 0), litres = ok.reduce((s, iv) => s + iv.litres, 0);
  if (!ok.length || hours < MIN_RATE_HOURS) return null;
  const days = hours / 24, perDay = litres / days, people = residents > 0 ? residents : 1;
  return { litres, hours, days, perDay, perPerson: perDay / people, intervals: ok.length, fromTs: ok[0].from.ts, toTs: ok[ok.length - 1].to.ts };
}

const previousDay = (key) => { const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/** Measured use for one calendar day: last reading on that day − last reading on the PREVIOUS day.
 *  Returns null when there's no reading the day before (a multi-day gap is an average, not one day's use),
 *  when the meter was reset in between, or when the difference is negative. `dayOf(ts)` → "YYYY-MM-DD". */
export function dayUse(readings, day, dayOf) {
  const rs = sortReadings(readings).map((r) => ({ ...r, date: r.date || dayOf(r.ts) }));
  const onDay = rs.filter((r) => r.date === day), before = rs.filter((r) => r.date < day);
  if (!onDay.length || !before.length) return null;
  const base = before[before.length - 1], last = onDay[onDay.length - 1];
  if (base.date !== previousDay(day)) return null;
  if (rs.some((r) => r.reset && r.ts > base.ts && r.ts <= last.ts)) return null;
  const diff = last.litres - base.litres;
  return diff >= 0 ? diff : null;
}

/** Checks a reading before it's saved. Returns a list of issues, most serious first.
 *  block: must not be saved as-is. confirm: ask the user. needsReset: lower than before — fix it or mark a meter reset. */
export function checkReading(readings, candidate) {
  const rs = sortReadings(readings), issues = [];
  const prev = rs.filter((r) => r.ts <= candidate.ts && r.id !== candidate.id).pop();
  const next = rs.find((r) => r.ts > candidate.ts && r.id !== candidate.id);
  const dup = rs.find((r) => Math.abs(r.ts - candidate.ts) <= DUPLICATE_WINDOW_MS && Math.abs(r.litres - candidate.litres) < 0.5);
  if (dup) return [{ code: "duplicate", level: "block", reading: dup }];
  const clash = rs.find((r) => Math.abs(r.ts - candidate.ts) < SAME_TIME_MS);
  if (clash) return [{ code: "sameTime", level: "block", reading: clash }];
  if (next && !next.reset && candidate.litres > next.litres) issues.push({ code: "higherThanNext", level: "block", reading: next });
  if (prev && !candidate.reset) {
    const diff = candidate.litres - prev.litres, days = Math.max((candidate.ts - prev.ts) / 864e5, 1);
    if (diff < 0) issues.push({ code: "lower", level: "needsReset", reading: prev });
    else if (diff > Math.max(5000, 2500 * days)) issues.push({ code: "bigJump", level: "confirm", reading: prev, litres: diff });
    if (prev.unit && candidate.unit && prev.unit !== candidate.unit) issues.push({ code: "unitChanged", level: "confirm", reading: prev });
  }
  return issues;
}

/** Meter facts for the chatbot, labelled so a cumulative dial value can never be mistaken for consumption.
 *  Only real intervals between two saved readings produce litres; nothing is extrapolated or invented.
 *  opts: { residents, today: "YYYY-MM-DD", dayOf(ts) → "YYYY-MM-DD", fmtTime(ts) → string, now, maxIntervals } */
export function meterContext(readings, { residents = 1, today, dayOf, fmtTime = (ts) => new Date(ts).toISOString(), now = Date.now(), maxIntervals = 5 } = {}) {
  const rs = sortReadings(readings).filter((r) => !r.demo);
  const round = (n) => (n == null ? null : Math.round(n));
  const label = (r) => `${Number(r.value)} ${r.unit === "ft3" ? "ft³" : "m³"}`;
  if (!rs.length) return { readingsSaved: 0, todayStatus: "no_meter_readings", todayMeasuredLitres: null,
    todayExplanation: "No meter readings are saved yet, so actual consumption is unknown." };
  const last = rs[rs.length - 1];
  const ivs = intervals(rs, { residents }).slice(-maxIntervals).reverse().map((iv) => ({
    from: fmtTime(iv.from.ts), to: fmtTime(iv.to.ts), hours: +iv.hours.toFixed(1),
    status: iv.status, // ok | short (<12 h, no daily rate) | reset (meter replaced, not usage) | negative (invalid)
    litresUsed: round(iv.litres),
    litresPerDay: round(iv.perDay), litresPerPersonPerDay: round(iv.perPerson)
  }));
  const measured = dayUse(rs, today, dayOf);
  const onToday = rs.filter((r) => dayOf(r.ts) === today), before = rs.filter((r) => dayOf(r.ts) < today);
  let todayStatus, todayExplanation;
  if (measured != null) {
    todayStatus = "measured";
    todayExplanation = "Measured: last reading today minus the last reading yesterday.";
  } else if (!onToday.length) {
    todayStatus = "no_reading_today";
    todayExplanation = "No meter reading saved today yet, so today's actual consumption can't be determined. Earlier intervals are below.";
  } else if (onToday.some((r) => r.reset)) {
    todayStatus = "meter_reset_today";
    todayExplanation = "The meter was marked as replaced/reset today; usage restarts from that reading.";
  } else if (!before.length) {
    todayStatus = onToday.length > 1 ? "only_readings_from_today" : "first_reading";
    todayExplanation = onToday.length > 1
      ? "All readings are from today, so only the partial interval between them is known — not a full day."
      : "This is the first reading. Consumption needs a second reading later.";
  } else {
    const prev = before[before.length - 1], days = (last.ts - prev.ts) / 864e5;
    todayStatus = "gap_since_previous_reading";
    todayExplanation = `The latest reading is from today (${fmtTime(last.ts)}). The reading before it is from ${fmtTime(prev.ts)}, about ${Math.round(days)} days earlier — not from yesterday. So the latest interval covers ${Math.round(days)} days; its litres per day is an average over that period, not today's use.`;
  }
  const avg = average(rs, { residents, sinceTs: now - 7 * 864e5 });
  return {
    readingsSaved: rs.length,
    latestReading: { cumulativeMeterTotal: label(last), readAt: fmtTime(last.ts),
      note: "Cumulative total shown on the meter since installation — NOT consumption." },
    todayStatus, todayExplanation,
    todayMeasuredLitres: round(measured),
    recentIntervals: ivs,
    average7Days: avg ? { litresPerDay: round(avg.perDay), litresPerPersonPerDay: round(avg.perPerson), basedOnHours: Math.round(avg.hours) } : null
  };
}

const meterUsage = { L_PER, MIN_RATE_HOURS, DUPLICATE_WINDOW_MS, SOURCES, toLitres, sortReadings, intervals, average, dayUse, checkReading, meterContext };
if (typeof window !== "undefined") window.DW_METER_USAGE = meterUsage;
export default meterUsage;
