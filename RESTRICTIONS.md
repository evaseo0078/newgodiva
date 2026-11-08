# Calgary restriction verification and calendar

## What was hardcoded

The existing verifier dynamically extracted only the current stage, supporting
URLs and verification time. Effective dates were always null. The calendar had
a manually entered November 4, 2026 Stage 4 start, a four-week duration and a fixed
verification cutoff. Its presentation extended the matching open declaration
through every future month. Construction notices also have curated dates, but
they are separate events and never establish water restrictions.

The November runtime record has been removed. November examples remain only in
regression fixtures. No production parser, timeline or presentation condition
matches a particular month, year, stage or declaration filename.

## Files in this change

| Files | Purpose |
| --- | --- |
| `lib/announcement-extraction.mjs`, `lib/official-announcements.mjs` | Official discovery, HTML/PDF parsing and structured facts |
| `lib/restrictions.mjs`, `lib/restriction-history.mjs` | Cached stage verification, metadata, persistent observations and revision audit |
| `data/restriction-timeline.js`, `data/restriction-calendar.js`, `data/calendar-presentation.js` | Generated ranges, validation, bounded estimates and calendar states |
| `app.js`, `index.html`, `styles.css` | Current summary, contextual legends, readable details and separate views |
| `package.json`, `package-lock.json`, `vercel.json` | PDF parser dependency, worker packaging and function time allowance |
| `scripts/check-restrictions.mjs`, `scripts/check-calendar-browser.mjs` | Reproducible live audit and desktop/mobile browser checks |
| `tests/announcement-timeline.test.mjs`, `tests/api-compatibility.test.mjs` | Synthetic extraction/timeline scenarios and API compatibility |
| `tests/calendar-presentation.test.mjs`, `tests/restriction-calendar.test.mjs`, `tests/restrictions-ui.test.mjs`, `tests/restrictions.test.mjs`, `tests/fixtures/restriction-scenarios.js` | Existing-feature regression coverage and isolated November fixture |
| `data/calgary-time.js`, `data/household-calendar.js`, `tests/calendar-audit.test.mjs` | Consistent Alberta time, recorded-only household goals, and calendar audit regressions |

## Calendar audit: timezone and household data

The previous server used Node's bundled tzdata 2025b, while an updated browser
could use the newer Alberta timezone rules. This made the extractor convert
the City's 12:01 a.m. ABT declaration to 07:01 UTC incorrectly. The current live
declaration extracts to **2026-11-04T06:01:00Z**, displayed as **12:01 a.m. ABT**.
07:01 UTC is correctly displayed as 1:01 a.m. ABT; it is not the declared start.

Alberta adopted year-round UTC-6 in November 2026:
https://www.alberta.ca/albertas-new-time-system-abt.
IANA's 2026f America/Edmonton data incorporates the change:
https://data.iana.org/time-zones/tzdb-2026f/northamerica.
`data/calgary-time.js` shares historical America/Edmonton rules and the official
post-transition Alberta rule between Node and the browser. A small fixed-zone
compatibility fallback after the transition avoids relying on outdated host
tzdata; it is timezone policy data, not a restriction event date. Earlier skipped
and repeated DST hours are still rejected when converting an ambiguous clock
time. Future dates no longer invent the abolished seasonal transitions. Update
this versioned policy if Alberta changes its timezone legislation again.

Snapshots and announcements carry `timezoneVersion`. An older cached snapshot
forces a new verification. Preserved source clock times can correct generated
instants without rewriting original audit entries. A cached precise time without
enough source information is withheld until it can be verified, rather than
blindly shifting its UTC value. Verification timestamps remain unchanged during
an outage. Calendar day keys also use the shared rules, including records near
local midnight. Automatically generated observations with an old saved date key
are resolved to the correct date from their original UTC verification instant;
their stage and verification time do not change. Corrected timezone metadata
wins over an equally dated older browser copy. Manually curated archive entries
are not re-dated from their review timestamps.

Household Goals uses actual non-demo records from the existing local/online
household state. A valid meter difference requires readings on consecutive
Calgary dates; an isolated reading or a multi-day gap cannot become an over-goal
daily result. Valid measured zero is recorded usage. Actual activity logs can
supply a clearly labelled estimate when a daily meter result is unavailable.
Missing records, missing goals and unavailable daily totals have separate neutral
states. The demo feature elsewhere in the app is preserved, but its records are
excluded from calendar goals.

Past days are compared against the **current** household goal: the project has
no historical goal settings. Activity logs may be incomplete, and meter totals
cover the interval between readings, not necessarily exactly 24 hours or
midnight-to-midnight. These records are not a complete utility billing history.

The two construction records remain manually curated from the October 22,
2026 notice (verified November 8, 2026):
https://www.calgary.ca/content/dam/www/is/utilities-delivery/bearspaw-feeder-main/documents/october-22-construction-notice.pdf.

| Activity | Notice evidence | Stored planning period |
| --- | --- | --- |
| Feeder main draining | Page 2: November 4, approximately four days | November 4-7, 2026 |
| 24-hour intersection construction | Page 1: expected November 14, approximately ten days | November 14-23, 2026 |

Both end dates are calculated inclusive boundaries, not verified completion
dates. Config records retain the duration, publication date, verification time,
page number and `endDerived: true`. The Construction view says that its notice
dates are curated estimates, not live progress or water restriction orders.
This PDF has five pages and exceeds the production declaration reader's
four-page limit; it was checked separately for this audit without relaxing the
declaration fetch/parser limits.

## Official sources and extraction

No documented official current-restriction API was identified. The existing
present-tense stage verifier still checks these City pages:

- https://www.calgary.ca/planning/water/bearspaw-feeder-main/water-restrictions.html
- https://www.calgary.ca/water/drought.html

It ignores future/historical claims and navigation/scripts, rejects conflicting
current declarations, and can accept one explicit declaration when the other
page is unavailable. Newsroom headlines do not override this current-stage check.
There is no AI inference or production stage override.

`lib/official-announcements.mjs` also discovers relevant official links from
those pages and https://newsroom.calgary.ca/?h=1. It follows an advertised RSS
feed when available, linked restriction declarations/removals in PDF form, and
water-related newsroom articles. It revisits recent previously verified sources.
Discovery checks at most ten linked documents plus the three entry pages and
one advertised feed per refresh; it does not crawl the entire historical archive.
Only HTTPS Calgary/Calgary Newsroom hosts are accepted, including redirects.

`lib/announcement-extraction.mjs` uses JSON-LD or meta publication timestamps
where supplied, separately retains page modification dates, and deterministically
extracts restriction stages, effective dates/times, explicit ends, lifting notices,
changes, duration estimates and estimate revisions from announcement text.
Text-based declarations use the pinned `pdfjs-dist` parser with evaluation
disabled, a four-page limit and a two-megabyte document limit. No OCR service,
LLM, paid API or additional hosted service is used.

An update/publication timestamp is not a legal effective time. Date-only notices
retain date precision; missing times stay null. English dates without a year
require dated source context, and ambiguous rollover dates are withheld.
Civil dates/times are interpreted in America/Edmonton. Nonexistent or ambiguous
DST clock times retain the date without inventing an exact instant.

The live audit on November 8, 2026 discovered the City's linked declaration and
extracted November 4 at 12:01 a.m. Calgary time, plus "approximately four weeks"
from official HTML. No confirmed end was found. These are retrieved facts, not
runtime constants. City pages without publication metadata return null rather
than treating their "Updated" date as a publication date.

## Structured records and timelines

`data/restriction-timeline.js` builds date ranges from extracted announcements.
Each range includes `id`, `stage` (0-4), `start`, nullable `end`, `status`
(`confirmed`, `scheduled`, `estimated`, `unknown`), `source` and `verifiedAt`.
Additional fields preserve `startsAt`/`endsAt`, publication metadata,
`declarationSource`, provenance, revision identifiers, `expectedDuration`,
`estimateSource`, `estimate` and `estimatedThrough`.

`end` is set only by an explicit confirmed end, effective stage change or lifting
announcement. A current-stage observation alone never invents a transition date
or closes an earlier range. Future scheduled changes remain scheduled, even
after their planned start, until a corroborating announcement confirms them.
They do not backfill the preceding months as confirmed history.

Estimates preserve the original language and use inclusive civil date arithmetic.
For example, an approximate four-week period starting November 4 has an
approximate last covered day of December 1. This is a derived planning boundary,
not an official expiry date. Numeric/word durations, day/week/month units and
ranges such as "two to three weeks" are supported. "At least four weeks" has no
upper boundary. An extension such as "another two weeks from today" is anchored
to the publication date; an extension without a clear anchor retains its wording
but cannot produce a new calendar boundary.

New versions of an announcement replace its presentation while earlier extracted
versions remain in the audit history. Same-date conflicting stages and conflicting
current effective start dates produce unknown coverage and warnings. Conflicting
duration estimates without a reliable publication/revision order withhold the
forecast; a clearly later dated estimate takes precedence. An explicit
timed change is represented as an intraday transition.

## Calendar behavior

`data/restriction-calendar.js` validates ranges, merges history and generates
42-day month grids. UTC civil arithmetic prevents DST/viewer timezone shifts.
Month/year navigation makes no API requests. The retained, previously reviewed
historical archive contains July/August 2024 observations and the March 9-April 2,
2026 closed range, including the April 2, 9 a.m. lifting transition. It is partial:
there is no verified complete 2024/2025/2026 timeline or uninterrupted Stage 0
interval between spring and November. Missing history says **Historical data
unavailable**, never **No Restrictions**.

`data/calendar-presentation.js` distinguishes confirmed historical coverage,
the current verified day, scheduled starts, striped estimated continuation and
unknown dates. Estimates end at their announced/derived boundary. Without an
estimate, there is no future band. A passed estimate does not establish lifting:
the current-stage summary remains visible and says to follow the restriction
until the City announces a change. Future months are not filled indefinitely.
Future dates are never labelled independently verified.

Water Restrictions is the default view. Household Goals and Construction remain
separate views with contextual legends. The current summary is above the filters;
day details are short and keep sources/check dates in an expandable section.
Construction dates in `data/config.js` remain curated, explicitly tentative where
applicable, and independent of restriction detection and timeline calculations.

## Caching, failures and durable storage

Successful verification is cached for 15 minutes. A collection has a 24-second
network deadline; individual standalone fetches have an eight-second timeout.
Failed current-stage verification retries after a one-minute backoff. The browser
polls every five minutes and on reconnection, allowing 45 seconds for the complete
status/history response. Server functions allow 60 seconds for source collection,
PDF parsing and persistence. Responses send `Cache-Control: no-store`.

The service retains the last successful stage and its original timestamp on
source failure or conflict. Missing/changed announcement formats produce warnings
and unknown fields rather than guessed dates. Old cache snapshots trigger a new
structured check but remain available as stale fallback. With no verified cache,
the UI shows status unavailable rather than a default stage.

Memory and temporary files are best-effort fallbacks. For reliable retention
across Vercel instances, restarts and deployments, configure the existing optional
Upstash Redis REST integration using **server-only** environment variables:

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

The existing keys `dropwise:restrictions:v1` and
`dropwise:restriction-history:v1` are reused without expiry. The snapshot uses
schema version 2, and the history response uses `timelineVersion: 2`.
Each date/stage observation has its own hash field. Accepted and rejected
announcement revisions have separate immutable audit fields; repeated unchanged
facts are deduplicated. Individual hash writes preserve unrelated records under
concurrent server instances. Browser localStorage also retains available history.
No Supabase schema changes or credentials in browser code are required.

The status endpoint includes structured metadata, announcements and a `history`
object with records, audit revisions, partial coverage, storage availability and
extraction warnings. Without Redis, `history.storage` is `temporary` and the UI
warns that some records may be missing. Configure durable storage before relying
on history surviving a cold start. Audit size grows with actual fact revisions;
retention is not automatically pruned.

## Remaining extraction limits

Discovery is bounded and request-driven, not a comprehensive archival ingestion
or scheduled monitoring service. An announcement posted and removed between
visits may never be observed. There is no claim that every historical stage has
been retrieved. The extractor supports validated English wording; scanned PDFs,
unsupported wording, vague windows such as "late spring," absent effective dates,
unclear extension anchors and contradictory claims require review. These details
remain unknown or retain the last sourced information with warnings. Publication
times and official expiry dates cannot be manufactured when a source omits them.
Source links and original extracted evidence/revisions remain available for review.

Stage rules remain curated in `data/restrictions.js` from the City's guidance and
fine schedule. They are not rewritten by scraping. Existing five-stage rule cards,
legal exceptions, browsable stage guide, Discord, Gemini, chat and Supabase flows
are preserved. Historical rules may differ; consult the dated announcement.

## Local testing

Install dependencies and run all automated tests:

```
npm ci
npm test
```

PowerShell can use `npm.cmd`. Synthetic tests cover stages in other months,
transitions, early lifting, extensions, missing durations/data, scheduled starts,
source failures/conflicts, PDF text, timezone/DST, history restart persistence,
browser rendering and all eight API module imports. Integration tests use mocked
official responses; they do not call paid services or send Discord messages.

Read-only live source audit (no cache writes):

```
node scripts/check-restrictions.mjs --summary
```

Live local preview, including the status/history endpoint:

```
node scripts/restrictions-dev.mjs
```

Visit http://127.0.0.1:3000 and choose guest access. For existing simple status
fixtures, append `0`, `1`, `2`, `3`, `4`, `stale` or `unknown`. These fixtures
deliberately do not invent effective dates or durations. Stop with Ctrl+C before
switching modes. To test an empty cache, clear only
`dw_verified_restrictions_v1`, preserving household data. Other application APIs
require `vercel dev` with the project's existing server environment variables.

Desktop/mobile Chrome layout checks with a synthetic May 2027 Stage 2 timeline:

```
node scripts/check-calendar-browser.mjs
```

This check requires Node 22+ for its built-in WebSocket client and installed
Chrome. Set `CHROME_BIN` if Chrome is not at the default executable path. It uses
an isolated browser profile, local mocked responses, and screenshots in the OS
temporary directory. No application deployment, external writes, Git commit or
push is performed.
