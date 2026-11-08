import test from "node:test";
import assert from "node:assert/strict";
import { readHTML, readPDF, extractAnnouncements, officialURL } from "../lib/announcement-extraction.mjs";
import { collectAnnouncements, fetchOfficial, NEWSROOM } from "../lib/official-announcements.mjs";
import timeline from "../data/restriction-timeline.js";
import calendar from "../data/restriction-calendar.js";
import view from "../data/calendar-presentation.js";
import { createHistoryStore } from "../lib/restriction-history.mjs";
import { createRestrictionService, SOURCES, TTL } from "../lib/restrictions.mjs";

const source = "https://newsroom.calgary.ca/water-restrictions-test/";
function extract(text, published = "2027-05-01T12:00:00-06:00", url = source, checked = "2027-05-10T18:00:00Z") {
  return extractAnnouncements(readHTML(`<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", datePublished: published })}</script><article>${text}</article>`, url, checked));
}
function phase(text, published, checked) {
  const events = extract(text, published, source, checked).announcements;
  return timeline.buildTimeline(events).records[0];
}
function pdfBytes(text) {
  const stream = `BT /F1 10 Tf 30 700 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const offset = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;
  return Buffer.from(content);
}

test("a different-month Stage 2 announcement yields its effective time and approximate range", () => {
  const record = phase("Stage 2 water restrictions begin May 3, 2027 at 6:00 am for approximately two weeks.");
  assert.equal(record.stage, 2);
  assert.equal(record.start, "2027-05-03");
  assert.equal(record.startsAt, "2027-05-03T12:00:00.000Z");
  assert.equal(record.end, null);
  assert.equal(record.estimate.latest, "2027-05-16");
  assert.equal(record.expectedDuration, "approximately two weeks");
  assert.equal(record.publishedAt, "2027-05-01T18:00:00.000Z");
  assert.equal(view.periodsForDay("2027-05-17", [record], { today: "2027-05-10" }).length, 0);
});

test("a Stage 3 to Stage 1 announcement closes history without erasing the previous stage", () => {
  const start = extract("Stage 3 water restrictions take effect May 3, 2027 at 6:00 am.").announcements;
  const change = extract("The City is moving from Stage 3 to Stage 1 water restrictions effective May 8, 2027 at 9:00 am.", "2027-05-08").announcements;
  const records = timeline.buildTimeline([...start, ...change], { currentStatus: { stage: 1, verifiedAt: "2027-05-10T18:00:00Z" } }).records;
  assert.equal(records.length, 2);
  assert.equal(records[0].end, "2027-05-08");
  assert.equal(records[0].endsAt, "2027-05-08T15:00:00.000Z");
  assert.equal(calendar.resolveDay("2027-05-07", records, { today: "2027-05-10" }).stage, 3);
  assert.equal(calendar.resolveDay("2027-05-08", records, { today: "2027-05-10" }).status, "transition");
  assert.equal(calendar.resolveDay("2027-05-09", records, { today: "2027-05-10" }).stage, 1);
});

test("lifting earlier than the estimate confirms an end and suppresses the obsolete forecast", () => {
  const start = extract("Stage 2 water restrictions begin May 3, 2027 for approximately four weeks.").announcements;
  const lift = extract("All water restrictions are lifted effective May 8, 2027 at 9:00 am.", "2027-05-08").announcements;
  const records = timeline.buildTimeline([...start, ...lift]).records;
  assert.equal(records[0].end, "2027-05-08");
  assert.equal(records[1].stage, 0);
  assert.equal(view.periodsForDay("2027-05-15", records, { today: "2027-05-10" }).length, 0);
  assert.equal(calendar.resolveDay("2027-05-15", records, { today: "2027-05-10" }).stage, null);
});

test("an expired estimate does not lift the order or extrapolate future Stage 4 days", () => {
  const events = extract("Stage 4 water restrictions begin May 3, 2027 for approximately one week.").announcements;
  const currentStatus = { stage: 4, verifiedAt: "2027-05-20T18:00:00Z", stale: false };
  const records = timeline.buildTimeline(events, { currentStatus }).records;
  assert.equal(records[0].end, null);
  assert.equal(view.periodsForDay("2027-05-20", records, { today: "2027-05-20", currentStatus })[0].status, "active");
  assert.equal(view.periodsForDay("2027-05-21", records, { today: "2027-05-20", currentStatus }).length, 0);
  assert.equal(records[0].estimate.latest, "2027-05-09");
});

test("a restriction with no estimate has an unknown end and no future bands", () => {
  const record = phase("Stage 2 water restrictions begin May 3, 2027.");
  assert.equal(record.end, null);
  assert.equal(record.estimate, undefined);
  assert.equal(view.periodsForDay("2027-05-11", [record], { today: "2027-05-10" }).length, 0);
});

test("scheduled announcements remain scheduled after their start passes until corroborated", () => {
  const record = phase("Stage 2 water restrictions will begin September 2, 2027 for about three weeks.");
  assert.equal(record.status, "scheduled");
  assert.equal(record.start, "2027-09-02");
  assert.equal(view.periodsForDay("2027-09-02", [record], { today: "2027-05-10" })[0].status, "scheduled");
  assert.equal(view.periodsForDay("2027-09-03", [record], { today: "2027-05-10" })[0].status, "estimated");
  assert.equal(view.periodsForDay("2027-09-23", [record], { today: "2027-09-25" }).length, 0);
  assert.equal(calendar.resolveDay("2027-09-02", [record], { today: "2027-09-25" }).status, "scheduled");
});

test("unrelated construction dates and durations cannot establish a restriction start", () => {
  assert.equal(extract("Stage 2 water restrictions are in effect. Bridge construction begins June 2, 2027 for four weeks.").announcements.length, 0);
  assert.equal(extract("<p>Stage 2 water restrictions are in effect.</p><p>Road construction begins June 2, 2027 for four weeks.</p>").announcements.length, 0);
});

test("missing dates, impossible dates and conflicting sources remain unknown", () => {
  assert.equal(extract("Stage 3 water restrictions are in effect.").announcements.length, 0);
  assert.equal(extract("Stage 3 water restrictions begin February 30, 2027.").announcements.length, 0);
  const different = extract("Stage 4 water restrictions begin May 3, 2027.", undefined, "https://newsroom.calgary.ca/conflicting-water-notice/").announcements;
  const timelineResult = timeline.buildTimeline([...extract("Stage 2 water restrictions begin May 3, 2027.").announcements, ...different]);
  assert.ok(timelineResult.warnings.length);
  assert.equal(calendar.resolveDay("2027-05-03", timelineResult.records, { today: "2027-05-10" }).stage, null);
});

test("published and modified timestamps are separate and do not invent effective times", () => {
  const document = readHTML('<meta property="article:modified_time" content="2027-05-09T12:00:00-06:00"><main>Updated: May 9, 2027. Stage 2 water restrictions are in effect.</main>', source, "2027-05-10T18:00:00Z");
  assert.equal(document.publishedAt, null);
  assert.equal(document.publishedDate, null);
  assert.equal(document.sourceModifiedAt, "2027-05-09T18:00:00.000Z");
  const lift = extract("All water restrictions are lifted effective immediately.").announcements[0];
  assert.equal(lift.effectiveDate, "2027-05-01");
  assert.equal(lift.effectiveAt, null);
});

test("Edmonton time conversion, invalid dates and ranged durations are conservative", () => {
  assert.equal(timeline.parseDate("May 3 , 2027 at 12:01 am AB T").at, "2027-05-03T06:01:00.000Z");
  assert.equal(timeline.parseDate("January 3, 2027 at 12:01 am").at, "2027-01-03T06:01:00.000Z");
  assert.equal(timeline.localInstant("2025-03-09", 2, 30), null);
  assert.equal(timeline.localInstant("2025-11-02", 1, 30), null);
  assert.equal(timeline.parseDate("February 30, 2027"), null);
  assert.equal(timeline.estimateWindow("2027-12-20", timeline.parseDuration("approximately two to three weeks")).latest, "2028-01-09");
  assert.equal(timeline.estimateWindow("2028-01-31", timeline.parseDuration("one month")).latest, "2028-02-28");
});

test("linked text declarations are parsed without event-specific PDF filenames", async () => {
  const document = await readPDF(pdfBytes("May 3, 2027. I hereby declare Stage 2 water restrictions commencing May 3 , 2027 at 12:01 am AB T."), "https://www.calgary.ca/content/dam/declaration-test.pdf", "2027-05-10T18:00:00Z");
  const event = extractAnnouncements(document).announcements[0];
  assert.equal(event.stage, 2);
  assert.equal(event.effectiveAt, "2027-05-03T06:01:00.000Z");
  assert.equal(event.declaration, true);
  assert.equal(document.publishedDate, "2027-05-03");
  await assert.rejects(readPDF(Buffer.from("not a PDF"), source, document.verifiedAt));
});

test("news discovery uses linked official articles and bounded requests", async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url === NEWSROOM) return new Response(`<a href="${source}">Water restriction update</a><a href="https://example.com/water">Water</a>`, { headers: { "content-type": "text/html" } });
    return new Response(`<article>Stage 2 water restrictions begin May 3, 2027 for approximately two weeks.</article>`, { headers: { "content-type": "text/html" } });
  };
  const result = await collectAnnouncements({ sources: [SOURCES[0]], fetcher, now: new Date("2027-05-10T18:00:00Z") });
  assert.deepEqual(new Set(calls), new Set([SOURCES[0], NEWSROOM, source]));
  assert.ok(result.announcements.some(event => event.source === source));
  assert.deepEqual(result.failures, []);
});

test("official fetches reject unofficial redirects, oversized and changed formats", async () => {
  assert.equal(officialURL("https://calgary.ca.evil.test/"), null);
  assert.equal(officialURL("https://user:password@www.calgary.ca/"), null);
  await assert.rejects(fetchOfficial(source, async () => new Response(null, { status: 302, headers: { location: "https://example.com" } })), /redirect/);
  await assert.rejects(fetchOfficial(source, async () => new Response("{}", { headers: { "content-type": "application/json" } })), /format/);
  await assert.rejects(fetchOfficial(source, async () => new Response("x", { headers: { "content-type": "text/html", "content-length": "2000001" } })), /size/);
});

test("revised estimates persist through restart with all earlier audit revisions", async () => {
  const database = new Map();
  const remote = async command => command[0] === "HSET" ? database.set(command[2], command[3]) : [...database.entries()].flat();
  const options = { remote, append: async () => {}, read: async () => "" };
  const original = extract("Stage 2 water restrictions begin May 3, 2027 for approximately two weeks.").announcements;
  const revised = extract("Stage 2 water restrictions begin May 3, 2027 for approximately four weeks.", undefined, source, "2027-05-11T18:00:00Z").announcements;
  const store = createHistoryStore(options);
  await store.archive({ stage: 2, verifiedAt: "2027-05-10T18:00:00Z", sources: [source], announcements: original });
  await store.archive({ stage: 2, verifiedAt: "2027-05-11T18:00:00Z", sources: [source], announcements: revised });
  const history = await createHistoryStore(options).get({ stale: false });
  const record = history.records.find(value => value.id === "phase:2:2027-05-03");
  assert.equal(record.estimatedThrough, "2027-05-30");
  assert.equal(record.end, null);
  assert.equal(history.audit.length, 2);
  assert.equal(history.audit[0].duration.maximum, 2);
  assert.equal(history.storage, "durable");
});

test("a later estimate extension is anchored only when the announcement supplies an anchor", () => {
  const start = extract("Stage 2 water restrictions begin May 3, 2027 for approximately two weeks.").announcements;
  const update = extract("Stage 2 water restrictions have been extended for another two weeks from today.", "2027-05-15").announcements;
  const records = timeline.buildTimeline([...start, ...update]).records;
  assert.equal(records[0].estimate.anchor, "2027-05-15");
  assert.equal(records[0].estimatedThrough, "2027-05-28");
  assert.equal(records[0].end, null);
  const ambiguous = extract("Stage 2 water restrictions have been extended for approximately three weeks.", "2027-05-15").announcements;
  assert.equal(timeline.buildTimeline([...start, ...ambiguous]).records[0].estimate, null);
});

test("service extracts date metadata, caches the collection and preserves it after failures", async () => {
  const now = new Date("2026-09-10T18:00:00Z");
  let calls = 0;
  const service = createRestrictionService({ read: async () => null, write: async () => {} });
  const fetcher = async () => { calls++; return new Response("<main>Stage 2 water restrictions are in effect. Stage 2 water restrictions began September 3, 2026 for approximately two weeks.</main>", { headers: { "content-type": "text/html" } }); };
  const first = await service({ fetcher, now });
  assert.equal(first.stage, 2);
  assert.equal(first.effectiveDate, "2026-09-03");
  assert.equal(first.expectedWindow.latest, "2026-09-16");
  const count = calls;
  await service({ fetcher, now: new Date(+now + 1000) });
  assert.equal(calls, count);
  const unavailable = await service({ fetcher: async () => { throw new Error("offline"); }, now: new Date(+now + TTL + 1) });
  assert.equal(unavailable.stage, 2);
  assert.equal(unavailable.stale, true);
  assert.equal(unavailable.effectiveDate, first.effectiveDate);
});

test("an explicit confirmed end and an estimated end window stay distinct", () => {
  const confirmed = phase("Stage 2 water restrictions begin May 3, 2027 and will end May 20, 2027 at 9:00 am.");
  assert.equal(confirmed.end, "2027-05-20");
  assert.equal(confirmed.endsAt, "2027-05-20T15:00:00.000Z");
  const estimated = phase("Stage 2 water restrictions begin May 3, 2027 and are expected to end May 20, 2027.");
  assert.equal(estimated.end, null);
  assert.equal(estimated.estimate.latest, "2027-05-20");
  assert.equal(estimated.estimate.derived, false);
});

test("lower-bound durations preserve wording without inventing an upper boundary", () => {
  const record = phase("Stage 2 water restrictions begin May 3, 2027 for at least four weeks.");
  assert.equal(record.expectedDuration, "at least four weeks");
  assert.equal(record.estimate, null);
  assert.equal(record.estimatedThrough, null);
  assert.equal(record.end, null);
});

test("proposals and negative announcements cannot create confirmed or scheduled ranges", () => {
  for (const text of ["Stage 2 water restrictions may begin May 3, 2027.", "Stage 2 water restrictions will not begin May 3, 2027.", "Stage 2 water restrictions could begin May 3, 2027."]) {
    const result = extract(text);
    assert.equal(result.announcements.length, 0);
    assert.ok(result.warnings.length);
  }
});

test("conflicting effective dates with the same current stage withhold date coverage", () => {
  const verifiedAt = "2027-05-10T18:00:00Z";
  const first = extract("Stage 2 water restrictions begin May 3, 2027.").announcements.map(event => ({ ...event, currentContext: true }));
  const second = extract("Stage 2 water restrictions begin May 4, 2027.", undefined, SOURCES[0]).announcements.map(event => ({ ...event, currentContext: true }));
  const result = timeline.buildTimeline([...first, ...second], { currentStatus: { stage: 2, verifiedAt } });
  assert.ok(result.warnings.some(warning => /disagree.*start date/.test(warning)));
  assert.equal(result.records.filter(record => record.status === "confirmed").length, 0);
});

test("a later return to the same stage does not conflict with an earlier closed order", () => {
  const first = extract("Stage 2 water restrictions begin May 3, 2027.").announcements.map(event => ({ ...event, currentContext: true }));
  const next = extract("Stage 3 water restrictions begin May 8, 2027.", "2027-05-08").announcements;
  const again = extract("Stage 2 water restrictions begin May 12, 2027.", "2027-05-12", source, "2027-05-12T18:00:00Z").announcements.map(event => ({ ...event, currentContext: true }));
  const result = timeline.buildTimeline([...first, ...next, ...again], { currentStatus: { stage: 2, verifiedAt: "2027-05-12T18:00:00Z" } });
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.records.map(record => record.stage), [2, 3, 2]);
  assert.equal(result.records[0].end, "2027-05-08");
  assert.equal(result.records[1].end, "2027-05-12");
});

test("a scheduled future change does not backfill or close an earlier verified period", () => {
  const start = extract("Stage 2 water restrictions begin May 3, 2027.").announcements;
  const next = extract("Stage 3 water restrictions will begin August 8, 2027.").announcements;
  const records = timeline.buildTimeline([...start, ...next]).records;
  assert.equal(records[0].end, null);
  assert.equal(calendar.resolveDay("2027-07-01", records, { today: "2027-05-10" }).stage, null);
});

test("discovery request limits do not depend on the selected date range", async () => {
  let count = 0;
  const fetcher = async url => {
    count++;
    const body = url === NEWSROOM ? Array.from({ length: 100 }, (_, index) => `<a href="https://newsroom.calgary.ca/water-${index}/">Water</a>`).join("") : "<main>No water announcement.</main>";
    return new Response(body, { headers: { "content-type": "text/html" } });
  };
  await collectAnnouncements({ sources: SOURCES, fetcher });
  assert.equal(count, 13);
});

test("time-before-date statements retain the explicitly announced Edmonton time", () => {
  const event = extract("All water restrictions are lifted effective at 9 a.m. on May 8, 2027.").announcements[0];
  assert.equal(event.effectiveAt, "2027-05-08T15:00:00.000Z");
});

test("a third repeated claim does not erase a same-date stage contradiction", () => {
  const first = extract("Stage 2 water restrictions begin May 3, 2027.").announcements;
  const second = extract("Stage 4 water restrictions begin May 3, 2027.", undefined, SOURCES[0]).announcements;
  const repeated = extract("Stage 4 water restrictions begin May 3, 2027.", undefined, SOURCES[1]).announcements;
  const result = timeline.buildTimeline([...first, ...second, ...repeated]);
  assert.ok(result.records.every(record => record.status === "unknown"));
  assert.equal(calendar.resolveDay("2027-05-03", result.records, { today: "2027-05-10" }).stage, null);
});

test("a lifting notice does not borrow an earlier start date from article context", () => {
  const result = extract("Stage 2 water restrictions began on May 3, 2027. All water restrictions are lifted effective May 8, 2027.");
  assert.equal(result.announcements.find(event => event.kind === "lifting").effectiveDate, "2027-05-08");
});

test("general lifting language is supported without treating a single-stage removal as Stage 0", () => {
  const general = extract("Outdoor water restrictions have been lifted effective May 8, 2027 at 9:00 am.").announcements;
  assert.equal(general[0].stage, 0);
  assert.equal(general[0].effectiveAt, "2027-05-08T15:00:00.000Z");
  const partial = extract("Stage 3 outdoor water restrictions are lifted effective May 8, 2027.").announcements;
  assert.equal(partial.some(event => event.stage === 0), false);
  assert.equal(partial[0].kind, "end");
});

test("explicit estimated end windows retain both boundaries without becoming expiry dates", () => {
  const record = phase("Stage 2 water restrictions begin May 3, 2027 and are expected to end between May 24 and May 31, 2027.");
  assert.equal(record.estimate.earliest, "2027-05-24");
  assert.equal(record.estimate.latest, "2027-05-31");
  assert.equal(record.end, null);
  assert.match(record.expectedDuration, /expected to end between/);
});

test("vague announced end windows preserve their wording and expose extraction limits", () => {
  const extracted = extract("Stage 2 water restrictions begin May 3, 2027 and are expected to end in late spring.");
  assert.ok(extracted.warnings.length);
  const record = timeline.buildTimeline(extracted.announcements).records[0];
  assert.match(record.expectedDuration, /late spring/);
  assert.equal(record.estimate, null);
  assert.equal(record.end, null);
});

test("contradictory estimates without a clear revision order withhold the future forecast", () => {
  const first = extract("Stage 2 water restrictions begin May 3, 2027 for approximately two weeks.").announcements;
  const second = extract("Stage 2 water restrictions begin May 3, 2027 for approximately four weeks.", undefined, SOURCES[0]).announcements;
  const result = timeline.buildTimeline([...first, ...second]);
  assert.equal(result.records[0].estimateConflict, true);
  assert.equal(result.records[0].estimatedThrough, null);
  assert.equal(result.records[0].end, null);
  assert.ok(result.warnings.some(warning => /conflicting duration estimates/.test(warning)));
});

test("a later explicitly dated estimate wins regardless of effective-date sorting", () => {
  const original = extract("Stage 2 water restrictions begin May 3, 2027 for approximately two weeks.").announcements;
  const updated = extract("Stage 2 water restrictions begin May 3, 2027 for approximately five weeks.", "2027-05-08", SOURCES[0]).announcements;
  const result = timeline.buildTimeline([...updated, ...original]);
  assert.equal(result.records[0].estimatedThrough, "2027-06-06");
  assert.equal(result.records[0].estimateConflict, false);
});
