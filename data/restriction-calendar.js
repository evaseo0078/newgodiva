import calgaryTime from "./calgary-time.js";

const calendar = (() => {
  const timezone = calgaryTime.timezone;
  const reviewedAt = "2026-11-08T05:12:50.000Z";
  const records = [
    { id: "2024-july17-stage3", stage: 3, start: "2024-07-17", end: null, status: "confirmed", kind: "observation",
      source: "https://newsroom.calgary.ca/update-july-17-critical-water-main-break-affecting-city-wide-water-usage/", verifiedAt: reviewedAt,
      detail: "The July 17 announcement confirms Stage 3 on this date only. Refer to the dated source for the rules that applied then." },
    { id: "2024-july18-stage2", stage: 2, start: "2024-07-18", end: null, status: "confirmed", kind: "observation",
      source: "https://newsroom.calgary.ca/update-july-18-critical-water-main-break-affecting-city-wide-water-usage/", verifiedAt: reviewedAt,
      detail: "The July 18 announcement confirms the move to Stage 2. The effective time is not specified here; this is a dated observation, not a full-day or continuous range claim." },
    { id: "2024-july22-stage2", stage: 2, start: "2024-07-22", end: null, status: "confirmed", kind: "observation",
      source: "https://newsroom.calgary.ca/update-july-22-critical-water-main-break-affecting-city-wide-water-usage/", verifiedAt: reviewedAt,
      detail: "Stage 2 remained in effect. The earlier tentative July 22 move to Stage 1 did not take place." },
    { id: "2024-august26-stage4", stage: 4, start: "2024-08-26", end: null, status: "confirmed", kind: "observation",
      source: "https://newsroom.calgary.ca/update-august-26-critical-water-main-repair-affecting-city-wide-water-usage/", verifiedAt: reviewedAt,
      detail: "Stage 4 was in effect from 12:01 a.m. on August 26. No end date is established by this entry. Historical rules may differ from the current guide." },
    { id: "2026-spring-stage4", stage: 4, start: "2026-03-09", end: "2026-04-02", status: "confirmed", kind: "declaration",
      source: "https://newsroom.calgary.ca/stage-4-water-restrictions-now-in-effect-as-bearspaw-south-feeder-main-repairs-begin/",
      endSource: "https://www.calgary.ca/content/dam/www/uep/water/documents/water-documents/2026-bearpsaw-feedermain-h20c/stage-4-restrictions-removal-April2.pdf",
      endsAt: "2026-04-02T09:00:00-06:00", verifiedAt: reviewedAt,
      detail: "Stage 4 began March 9. It ended April 2 at 9 a.m. Calgary time; April 2 is a transition day." },
    { id: "2026-april-lifting", stage: 0, start: "2026-04-02", end: null, status: "confirmed", kind: "observation",
      source: "https://newsroom.calgary.ca/water-restrictions-lifted-as-bearspaw-south-feeder-main-returns-to-service/",
      startsAt: "2026-04-02T09:00:00-06:00", verifiedAt: reviewedAt,
      detail: "Restrictions lifted April 2 at 9 a.m. This record does not establish the status of later dates." },
  ];
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T12:00:00Z");
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
  }
  function dayKey(value = new Date()) {
    return calgaryTime.dayKey(value);
  }
  function officialSource(value) {
    try { const url = new URL(value); return url.protocol === "https:" && ["www.calgary.ca", "calgary.ca", "newsroom.calgary.ca"].includes(url.hostname); } catch { return false; }
  }
  function validRecord(record) {
    return record && typeof record.id === "string" && Number.isInteger(record.stage) && record.stage >= 0 && record.stage <= 4 &&
      validDate(record.start) && (record.end === null || validDate(record.end) && record.end >= record.start) &&
      ["confirmed", "scheduled", "estimated", "unknown"].includes(record.status) && officialSource(record.source) &&
      (!record.endSource || officialSource(record.endSource)) && (record.status !== "estimated" || record.end === null) &&
      (!record.declarationSource || officialSource(record.declarationSource)) &&
      Number.isFinite(Date.parse(record.verifiedAt)) &&
      (!record.verifiedThrough || validDate(record.verifiedThrough) && record.verifiedThrough >= record.start && record.verifiedThrough <= dayKey(record.verifiedAt)) &&
      (!record.estimatedThrough || validDate(record.estimatedThrough) && record.estimatedThrough >= record.start) &&
      (!record.startsAt || dayKey(record.startsAt) === record.start) && (!record.endsAt || dayKey(record.endsAt) === record.end);
  }
  function mergeRecords(...collections) {
    const merged = new Map();
    for (const input of collections.flat()) {
      const correctedDay = input?.kind === "observation" && input.timezoneVersion !== calgaryTime.version && input.id === `observed:${input.start}:${input.stage}` ? dayKey(input.verifiedAt) : null;
      const record = correctedDay && correctedDay !== input.start ? { ...input, start: correctedDay, id: `observed:${correctedDay}:${input.stage}`, timezoneVersion: calgaryTime.version } : input;
      if (!validRecord(record)) continue;
      const previous = merged.get(record.id);
      if (!previous || Date.parse(record.verifiedAt) > Date.parse(previous.verifiedAt) || record.verifiedAt === previous.verifiedAt && record.timezoneVersion === calgaryTime.version && previous.timezoneVersion !== calgaryTime.version) merged.set(record.id, record);
    }
    return [...merged.values()].sort((left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id));
  }
  function observation(snapshot) {
    if (!snapshot || snapshot.stale || !Number.isInteger(snapshot.stage) || !snapshot.verifiedAt) return null;
    const date = dayKey(snapshot.verifiedAt);
    const record = { id: `observed:${date}:${snapshot.stage}`, stage: snapshot.stage, start: date, end: null,
      kind: "observation", status: "confirmed", timezoneVersion: calgaryTime.version, source: snapshot.sources?.[0], verifiedAt: snapshot.verifiedAt,
      detail: "Verified on this date only. This observation does not establish an effective start, end or uninterrupted period." };
    return validRecord(record) ? record : null;
  }
  function resolveDay(date, history = [], { today = dayKey(), stale = false, conflict = false } = {}) {
    const unavailable = { status: "unknown", stage: null, records: [], stale,
      message: !validDate(date) ? "Date unavailable" : date > today ? "No official restriction announcement for this date" : "Historical data unavailable" };
    if (!validDate(date) || !validDate(today)) return unavailable;
    if (conflict && date === today) return { ...unavailable, status: "conflict", message: "Current official announcements conflict — restriction status uncertain" };
    const candidates = mergeRecords(history).filter(record => {
      if (date < record.start) return false;
      if (record.kind === "observation") return date === record.start;
      if (record.status === "estimated") return date <= (record.estimatedThrough || record.start);
      if (record.status === "scheduled") return date <= (record.end || record.start);
      return date <= (record.end || record.verifiedThrough || dayKey(record.verifiedAt));
    });
    if (!candidates.length) return unavailable;
    const certain = candidates.filter(record => record.status === "confirmed" || record.status === "scheduled");
    const selected = certain.length ? certain : candidates;
    const stages = new Set(selected.map(record => record.stage));
    if (selected.some(record => record.status === "unknown")) return { ...unavailable, records: selected };
    if (stages.size > 1) {
      const ordered = [...selected].sort((left, right) => Date.parse(left.startsAt || left.start) - Date.parse(right.startsAt || right.start));
      const transition = ordered.every((record, index) => !index || ordered[index - 1].endedBy === record.id || ordered[index - 1].endsAt && record.startsAt && Date.parse(ordered[index - 1].endsAt) <= Date.parse(record.startsAt));
      return { ...unavailable, records: selected, status: transition ? "transition" : "conflict",
        message: transition ? "Stage transition on this date — see effective times below" : "Conflicting or incomplete stage information — status uncertain" };
    }
    const status = selected.every(record => record.status === "estimated") ? "estimated" : date > today || selected.some(record => record.status === "scheduled") ? "scheduled" : "confirmed";
    const stage = selected[0].stage;
    const outdated = stale || selected.some(record => record.end === null && date >= today && Date.now() - Date.parse(record.verifiedAt) > 900000);
    return { stage, status, records: selected, stale: outdated,
      message: `${stage ? `Stage ${stage}` : "No Restrictions"} · ${status}${outdated ? " · stale verification" : ""}` };
  }
  function shiftMonth(month, offset) {
    if (!validDate(month) || !Number.isInteger(offset)) return null;
    const date = new Date(month + "T12:00:00Z");
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + offset);
    if (!Number.isFinite(+date)) return null;
    const result = date.toISOString().slice(0, 10);
    return validDate(result) ? result : null;
  }
  function monthGrid(month) {
    if (!validDate(month)) return [];
    const first = new Date(month.slice(0, 7) + "-01T12:00:00Z");
    first.setUTCDate(1 - first.getUTCDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(+first + index * 86400000);
      return { key: date.toISOString().slice(0, 10), weekday: date.getUTCDay(), day: date.getUTCDate(), other: date.toISOString().slice(0, 7) !== month.slice(0, 7) };
    }).filter(day => validDate(day.key));
  }
  const calendar = { records, validDate, validRecord, mergeRecords, observation, resolveDay, shiftMonth, monthGrid, dayKey, timezone };
  return calendar;
})();

if (typeof window !== "undefined") window.DW_CALENDAR = calendar;

export default calendar;
