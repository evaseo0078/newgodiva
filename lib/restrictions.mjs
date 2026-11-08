import model from "../data/restrictions.js";
import calgaryTime from "../data/calgary-time.js";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveObservation } from "./restriction-history.mjs";
import { collectAnnouncements } from "./official-announcements.mjs";
import { buildTimeline, statusTimes } from "../data/restriction-timeline.js";
import { officialURL } from "./announcement-extraction.mjs";

export const SOURCES = [
  "https://www.calgary.ca/planning/water/bearspaw-feeder-main/water-restrictions.html",
  "https://www.calgary.ca/water/drought.html"
];
export const TTL = 15 * 60 * 1000;
const cachePath = join(tmpdir(), "dropwise-restrictions-v1.json");

export function extractStatus(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html;
  const text = main.replace(/<(script|style|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&rsquo;|&#8217;/g, "'").replace(/\s+/g, " ").trim();
  const opening = text.slice(0, 6000);
  const claims = [];
  for (const sentence of opening.split(/(?<=[.!?])\s+|(?=City-wide)/)) {
    if (/\b(will|starting|beginning|expected|anticipated|previously|were|was|would|could|not in effect|until|ended|last year)\b/i.test(sentence)) continue;
    for (const match of sentence.matchAll(/(?:city[- ]wide\s+)?stage\s+([1-4])\s+(?:outdoor\s+)?water\s+(?:use\s+)?restrictions\s+(?:are\s+|remain\s+|are\s+currently\s+)?(?:now\s+)?in\s+effect/gi)) claims.push(Number(match[1]));
    if (/\b(?:no (?:mandatory |outdoor )*water restrictions (?:are |are currently )?in effect|(?:all |outdoor )?water restrictions have been lifted)\b/i.test(sentence)) claims.push(0);
  }
  const unique = [...new Set(claims)];
  if (unique.length !== 1) {
    const error = new Error("No unambiguous current status declaration");
    if (unique.length > 1) error.code = "conflict";
    throw error;
  }
  return { stage: unique[0], evidence: opening.slice(0, 6000) };
}

export function validSnapshot(value) {
  return value && Number.isInteger(value.stage) && value.stage >= 0 && value.stage <= 4 &&
    Number.isFinite(Date.parse(value.verifiedAt)) && Date.parse(value.verifiedAt) <= Date.now() + 60000 &&
    Array.isArray(value.sources) && value.sources.length > 0 && value.sources.every(source => !!officialURL(source));
}

async function remoteCache(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(command), signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("Cache unavailable");
  const result = await response.json();
  if (result.error) throw new Error("Cache unavailable");
  return result.result;
}

async function loadCache() {
  for (const read of [async () => JSON.parse(await remoteCache(["GET", "dropwise:restrictions:v1"])), async () => JSON.parse(await readFile(cachePath, "utf8"))]) {
    try { const value = await read(); if (validSnapshot(value)) return value; } catch {}
  }
  return null;
}

async function verify(fetcher, now, previous = []) {
  const collected = await collectAnnouncements({ sources: SOURCES, fetcher, now, previous });
  const results = await Promise.allSettled(SOURCES.map(async source => {
    const document = collected.documents.find(value => value.primary && value.requestedSource === source);
    if (!document?.html) throw new Error("Official page unavailable");
    return { ...extractStatus(document.html), source: document.source };
  }));
  const verified = results.filter(result => result.status === "fulfilled").map(result => result.value);
  if (results.some(result => result.status === "rejected" && result.reason.code === "conflict")) {
    const error = new Error("Official page has conflicting current declarations");
    error.code = "conflict";
    error.announcements = collected.announcements;
    throw error;
  }
  if (!verified.length) { const error = new Error("Official sources unavailable"); error.announcements = collected.announcements; throw error; }
  if (new Set(verified.map(value => value.stage)).size !== 1) {
    const error = new Error("Official sources conflict");
    error.code = "conflict";
    error.announcements = collected.announcements;
    throw error;
  }
  const stage = verified[0].stage;
  const snapshot = { schemaVersion: 2, timezoneVersion: calgaryTime.version, stage, verifiedAt: now.toISOString(), sources: verified.map(value => value.source),
    announcements: [...new Map([...previous, ...collected.announcements].map(event => [event.revision, event])).values()], extractionWarnings: [...collected.warnings, ...collected.failures.map(value => ({ source: value.source, message: value.error }))],
    checkedSources: collected.checkedSources, effectiveFrom: null, effectiveTo: null, publishedAt: null, publishedDate: null };
  const timeline = buildTimeline(snapshot.announcements, { currentStatus: snapshot });
  const phase = timeline.records.filter(record => record.stage === stage && record.status === "confirmed" && record.start <= calgaryTime.dayKey(now) && (!record.end || record.end >= calgaryTime.dayKey(now))).at(-1);
  if (phase) Object.assign(snapshot, { effectiveFrom: phase.startsAt || phase.start, effectiveDate: phase.start, effectiveTo: phase.endsAt || phase.end,
    publishedAt: phase.publishedAt, publishedDate: phase.publishedDate, expectedDuration: phase.expectedDuration || null,
    expectedWindow: phase.estimate || null, declarationSource: phase.declarationSource || null });
  if (!phase) snapshot.extractionWarnings.push({ message: "The current stage was verified, but its effective start could not be reliably extracted." });
  snapshot.extractionWarnings.push(...timeline.warnings.map(message => ({ message })));
  return snapshot;
}

export function createRestrictionService({ read = loadCache, write = async snapshot => {
  await Promise.allSettled([writeFile(cachePath, JSON.stringify(snapshot)), remoteCache(["SET", "dropwise:restrictions:v1", JSON.stringify(snapshot)]), archiveObservation(snapshot)]);
} } = {}) {
  let memory = null, pending = null, lastAttempt = 0, lastError = false, lastIssue = null;
  return async function getRestrictions({ fetcher = fetch, now = new Date(), persist = true } = {}) {
  const cached = persist ? memory || await read() : null;
  const age = cached ? now - new Date(cached.verifiedAt) : Infinity;
  if (age >= 0 && age < TTL && !lastError && cached.schemaVersion === 2 && cached.timezoneVersion === calgaryTime.version) return present(cached, false, now);
  if (persist && lastError && now.getTime() - lastAttempt < 60000) return present(cached, true, now, lastIssue);
  try {
    if (!pending || !persist) pending = verify(fetcher, now, cached?.announcements || []);
    const snapshot = await pending;
    if (persist) {
      memory = snapshot;
      await write(snapshot);
    }
    lastError = false;
    return present(snapshot, false, now);
  } catch (error) {
    lastError = true;
    lastIssue = error.code === "conflict" ? "conflict" : "unavailable";
    return { ...present(cached, true, now, lastIssue), announcements: [...(cached?.announcements || []), ...(error.announcements || []).map(event => ({ ...event, accepted: false, rejectionReason: lastIssue }))] };
  } finally { pending = null; lastAttempt = now.getTime(); }
  };
}

export const getRestrictions = createRestrictionService();

function present(snapshot, stale, now, issue = null) {
  return { ...(snapshot || { stage: null, verifiedAt: null, sources: SOURCES, effectiveFrom: null, effectiveTo: null }),
    ...statusTimes(snapshot),
    stale, verificationIssue: stale ? issue || "unavailable" : null, checkedAt: now.toISOString(), nextCheckAt: new Date(now.getTime() + (stale ? 60000 : TTL)).toISOString(),
    warning: stale ? "Official status could not be verified. Check the City source; any displayed stage is the last verified status." : null,
    rules: snapshot ? model.stages[snapshot.stage] : null };
}
