import { collectAnnouncements } from "../lib/official-announcements.mjs";
import { SOURCES, extractStatus } from "../lib/restrictions.mjs";
import { buildTimeline } from "../data/restriction-timeline.js";
import calgaryTime from "../data/calgary-time.js";

const now = new Date();
const result = await collectAnnouncements({ sources: SOURCES, now });
const stages = result.documents.filter(document => document.primary).map(document => {
  try { return { source: document.source, ...extractStatus(document.html) }; } catch { return { source: document.source, stage: null }; }
});
const declarations = stages.filter(value => value.stage !== null);
const currentStatus = declarations.length && new Set(declarations.map(value => value.stage)).size === 1 ? { stage: declarations[0].stage, verifiedAt: now.toISOString(), stale: false } : null;
console.log(JSON.stringify({ timezone: calgaryTime.timezone, timezoneVersion: calgaryTime.version, stages: stages.map(({ source, stage }) => ({ source, stage })),
  documents: result.documents.map(({ source, publishedDate, sourceModifiedDate, links, text, pdf }) => ({ source, publishedDate, sourceModifiedDate, links: links.length, declarationDateText: pdf ? text.replace(/\s+/g, " ").match(/commencing.{0,100}/i)?.[0] : undefined })),
  announcements: result.announcements.map(event => process.argv.includes("--summary") ? { source: event.source, kind: event.kind, stage: event.stage, effectiveDate: event.effectiveDate, effectiveAt: event.effectiveAt, publishedDate: event.publishedDate, duration: event.duration?.text } : event), timeline: buildTimeline(result.announcements, { currentStatus }).records,
  warnings: result.warnings, failures: result.failures }, null, 2));
