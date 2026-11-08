import calendar from "./restriction-calendar.js";
import calgaryTime from "./calgary-time.js";

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const numbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
export function addDays(date, count) {
  if (!calendar.validDate(date) || !Number.isInteger(count)) return null;
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + count);
  return Number.isFinite(+value) && calendar.validDate(value.toISOString().slice(0, 10)) ? value.toISOString().slice(0, 10) : null;
}
export function localInstant(date, hour, minute = 0) {
  return calgaryTime.localInstant(date, hour, minute);
}
export function parseDate(text, contextDate = null) {
  const pattern = /\b(\d{4}-\d{2}-\d{2})\b|\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/i;
  const match = text.match(pattern);
  if (!match) return null;
  const month = match[2] ? months.findIndex(value => value.startsWith(match[2].toLowerCase().slice(0, 3))) + 1 : null;
  const year = match[4] || (calendar.validDate(contextDate) ? contextDate.slice(0, 4) : null);
  const date = match[1] || (year ? `${year}-${String(month).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : null);
  if (!calendar.validDate(date)) return null;
  const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 55);
  const precedingClock = text.slice(Math.max(0, match.index - 40), match.index).match(/(?:at\s+)?(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s+(?:on\s+)?$/i);
  const clock = tail.match(/^\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i) || precedingClock?.[1].match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i);
  const military = tail.match(/^\s+at\s+(\d{1,2}):(\d{2})(?!\s*[ap])/i);
  const midnight = /^\s+(?:at\s+)?midnight\b/i.test(tail);
  let hour = clock ? Number(clock[1]) % 12 + (/^p/i.test(clock[3]) ? 12 : 0) : military ? Number(military[1]) : midnight ? 0 : null;
  if (clock && (Number(clock[1]) < 1 || Number(clock[1]) > 12)) hour = null;
  const minute = Number(clock?.[2] || military?.[2] || 0);
  const at = hour === null ? null : localInstant(date, hour, minute);
  return { date, at, time: at ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : null,
    precision: at ? "minute" : "date", inferredYear: !match[1] && !match[4], text: match[0], index: match.index };
}
export function parseDuration(text) {
  const value = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const match = text.match(new RegExp(`\\b(?:(?:approximately|about|around|roughly|up to|at least|a minimum of|more than|over)\\s+)?(${value})(?:\\s*(?:to|[-–])\\s*(${value}))?\\s+(days?|weeks?|months?)\\b`, "i"));
  if (!match) return null;
  const numeric = word => Number(word) || numbers[word?.toLowerCase()];
  const minimum = numeric(match[1]), maximum = numeric(match[2] || match[1]);
  if (!(minimum > 0 && maximum >= minimum && maximum <= 730)) return null;
  return { text: match[0], minimum: /^up to/i.test(match[0]) ? 0 : minimum, maximum: /^(?:at least|a minimum of|more than|over)/i.test(match[0]) ? null : maximum, unit: match[3].toLowerCase().replace(/s$/, ""), approximate: true };
}
export function estimateWindow(start, duration) {
  if (!calendar.validDate(start) || !duration || !Number.isInteger(duration.maximum) || !Number.isInteger(duration.minimum) || duration.maximum < duration.minimum) return null;
  const boundary = amount => {
    if (amount === 0) return start;
    if (duration.unit === "month") {
      const date = new Date(start + "T12:00:00Z"), day = date.getUTCDate();
      date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount);
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, last));
      return addDays(date.toISOString().slice(0, 10), -1);
    }
    return addDays(start, amount * (duration.unit === "week" ? 7 : 1) - 1);
  };
  const earliest = boundary(duration.minimum), latest = boundary(duration.maximum);
  return earliest && latest ? { earliest, latest, derived: true, text: duration.text, anchor: start } : null;
}
export function latestAnnouncements(announcements = []) {
  const latest = new Map();
  for (const event of announcements) {
    if (!event || event.accepted === false || !event.id || !event.source || !Number.isFinite(Date.parse(event.verifiedAt))) continue;
    const previous = latest.get(event.id);
    const clock = event.effectiveTime?.match(/^(\d{2}):(\d{2})$/);
    const endClock = event.confirmedEnd?.time?.match(/^(\d{2}):(\d{2})$/);
    const normalized = event.timezoneVersion !== calgaryTime.version && (clock || endClock) ? { ...event,
      ...(clock ? { effectiveAt: localInstant(event.effectiveDate, Number(clock[1]), Number(clock[2])) } : {}),
      ...(endClock ? { confirmedEnd: { ...event.confirmedEnd, at: localInstant(event.confirmedEnd.date, Number(endClock[1]), Number(endClock[2])) } } : {}) } : event;
    if (!previous || Date.parse(event.verifiedAt) >= Date.parse(previous.verifiedAt)) latest.set(event.id, normalized);
  }
  const eventDay = event => event.effectiveDate || event.sourceModifiedDate || event.publishedDate || event.sourceModifiedAt || event.publishedAt || "";
  return [...latest.values()].sort((left, right) => eventDay(left).localeCompare(eventDay(right)) ||
    (left.sourceModifiedAt || left.publishedAt || "").localeCompare(right.sourceModifiedAt || right.publishedAt || ""));
}
export function buildTimeline(announcements = [], { currentStatus = null } = {}) {
  const records = [], warnings = [];
  const conflicting = new Set();
  const events = latestAnnouncements(announcements);
  const phaseFor = event => records.filter(record => record.stage === event.stage && record.start <= (event.publishedDate || event.effectiveDate || "") && record.end === null).at(-1);
  const applyEstimate = (phase, event, anchor) => {
    const rank = event.sourceModifiedDate || event.publishedDate || event.effectiveDate || "";
    const instant = event.sourceModifiedAt || event.publishedAt || null;
    const estimate = event.expectedWindow || estimateWindow(anchor, event.duration);
    const signature = JSON.stringify([event.duration?.minimum, event.duration?.maximum, event.duration?.unit, estimate?.earliest, estimate?.latest, event.estimateText && !event.duration && !estimate ? event.estimateText : null]);
    if (phase.estimateAnnouncementDate > rank || phase.estimateAnnouncementDate === rank && phase.estimateAnnouncementAt && instant && phase.estimateAnnouncementAt > instant) return;
    const sameOrder = phase.estimateAnnouncementDate === rank && !(phase.estimateAnnouncementAt && instant && phase.estimateAnnouncementAt !== instant);
    if (sameOrder && phase.estimateSignature !== signature) {
      phase.estimateConflict = true;
      phase.estimate = null; phase.estimatedThrough = null; phase.expectedDuration = null; phase.duration = null;
      warnings.push("Official announcements give conflicting duration estimates with no reliable revision order; the forecast is withheld.");
      return;
    }
    if (sameOrder && phase.estimateConflict) return;
    phase.estimateConflict = false;
    phase.estimateAnnouncementDate = rank;
    phase.estimateAnnouncementAt = instant;
    phase.estimateSignature = signature;
    phase.expectedDuration = event.duration?.text || event.estimateText || null;
    phase.duration = event.duration || null;
    phase.estimate = estimate;
    phase.estimatedThrough = estimate?.latest || null;
    phase.estimateSource = event.source;
  };
  for (const event of events) {
    if (event.kind === "estimate-update") {
      const phase = phaseFor(event);
      if (!phase) { warnings.push("An estimate update could not be associated with a verified start date."); continue; }
      applyEstimate(phase, event, event.estimateAnchor || (event.totalDuration ? phase.start : null));
      phase.verifiedAt = event.verifiedAt;
      phase.revisions.push(event.revision);
      continue;
    }
    if (!calendar.validDate(event.effectiveDate)) continue;
    if (event.kind === "end") {
      const phase = phaseFor(event);
      if (phase) { phase.end = event.effectiveDate; phase.endsAt = event.effectiveAt; phase.endSource = event.source; phase.verifiedAt = event.verifiedAt; phase.revisions.push(event.revision); }
      continue;
    }
    if (!["declaration", "lifting", "change"].includes(event.kind)) continue;
    let phase = records.find(record => record.stage === event.stage && record.start === event.effectiveDate);
    if (!phase) {
      phase = { id: `phase:${event.stage}:${event.effectiveDate}`, stage: event.stage, start: event.effectiveDate, end: event.confirmedEnd?.date || null,
        endsAt: event.confirmedEnd?.at || null, startsAt: event.effectiveAt || null, status: event.scheduled ? "scheduled" : "confirmed",
        kind: "declaration", origin: "official-extraction", timezoneVersion: calgaryTime.version, source: event.source, publishedAt: event.publishedAt, publishedDate: event.publishedDate,
        verifiedAt: event.verifiedAt, verifiedThrough: event.scheduled ? undefined : event.effectiveDate, revisions: [], provenance: [] };
      records.push(phase);
    }
    if (!event.scheduled) phase.status = "confirmed";
    phase.provenance.push({ source: event.source, publishedAt: event.publishedAt, publishedDate: event.publishedDate, verifiedAt: event.verifiedAt });
    phase.revisions.push(event.revision);
    if (event.declaration) { phase.declarationSource = event.source; phase.source = event.source; }
    if (event.declaration) { phase.publishedAt = event.publishedAt; phase.publishedDate = event.publishedDate; }
    if (event.effectiveAt) phase.startsAt = event.effectiveAt;
    if (Date.parse(event.verifiedAt) > Date.parse(phase.verifiedAt)) phase.verifiedAt = event.verifiedAt;
    if (event.duration || event.expectedWindow || event.estimateText) {
      applyEstimate(phase, event, phase.start);
    }
    if (event.confirmedEnd) { phase.end = event.confirmedEnd.date; phase.endsAt = event.confirmedEnd.at; phase.endSource = event.source; }
    for (const previous of records) {
      if (previous === phase || previous.status === "unknown" || previous.start > phase.start || previous.stage === phase.stage) continue;
      if (previous.start === phase.start && !event.fromStage && event.kind !== "lifting" && !(phase.startsAt && previous.startsAt && phase.startsAt > previous.startsAt)) {
        conflicting.add(previous.id); conflicting.add(phase.id);
        previous.status = "unknown"; phase.status = "unknown"; warnings.push("Official announcements give contradictory stages for the same effective date.");
      } else if (!event.scheduled && !previous.end && ["declaration", "lifting", "change"].includes(event.kind)) {
        previous.end = phase.start; previous.endsAt = phase.startsAt; previous.endSource = event.source; previous.endedBy = phase.id;
      }
    }
  }
  for (const phase of records) if (conflicting.has(phase.id)) phase.status = "unknown";
  const currentStarts = events.filter(event => event.currentContext && event.verifiedAt === currentStatus?.verifiedAt && event.kind === "declaration" && !event.scheduled && event.stage === currentStatus?.stage);
  if (new Set(currentStarts.map(event => event.effectiveDate)).size > 1) {
    for (const phase of records.filter(record => currentStarts.some(event => event.stage === record.stage && event.effectiveDate === record.start))) phase.status = "unknown";
    warnings.push("Current official pages disagree about the restriction start date; date coverage is withheld.");
  }
  const checkedDay = currentStatus?.verifiedAt ? calendar.dayKey(currentStatus.verifiedAt) : null;
  const current = records.filter(record => record.stage === currentStatus?.stage && record.status === "confirmed" && record.start <= checkedDay && (!record.end || record.end >= checkedDay)).at(-1);
  if (current && !currentStatus.stale) {
    current.verifiedThrough = checkedDay;
    if (Date.parse(currentStatus.verifiedAt) > Date.parse(current.verifiedAt)) current.verifiedAt = currentStatus.verifiedAt;
  }
  return { records: calendar.mergeRecords(records), warnings: [...new Set(warnings)], events };
}
export function reconcileTimeline(...collections) {
  const records = calendar.mergeRecords(...collections);
  const extracted = records.filter(record => record.origin === "official-extraction");
  return records.filter(record => record.origin === "official-extraction" || record.kind === "observation" || !extracted.some(other => other.stage === record.stage && other.start === record.start));
}
export function statusTimes(snapshot) {
  if (!snapshot) return { effectiveFrom: null, effectiveTo: null };
  if (snapshot.timezoneVersion === calgaryTime.version) return { effectiveFrom: snapshot.effectiveFrom, effectiveTo: snapshot.effectiveTo };
  const checkedDay = calendar.dayKey(snapshot.verifiedAt);
  const phase = buildTimeline(snapshot.announcements, { currentStatus: snapshot }).records.filter(record => record.stage === snapshot.stage && record.status === "confirmed" && record.start <= checkedDay && (!record.end || record.end >= checkedDay)).at(-1);
  return { effectiveFrom: phase ? phase.startsAt || phase.start : calendar.validDate(snapshot.effectiveDate) ? snapshot.effectiveDate : calendar.validDate(snapshot.effectiveFrom) ? snapshot.effectiveFrom : null,
    effectiveTo: phase ? phase.endsAt || phase.end : calendar.validDate(snapshot.effectiveTo) ? snapshot.effectiveTo : null };
}
const timeline = { parseDate, parseDuration, estimateWindow, localInstant, addDays, latestAnnouncements, buildTimeline, reconcileTimeline, statusTimes };
if (typeof window !== "undefined") window.DW_TIMELINE = timeline;
export default timeline;
