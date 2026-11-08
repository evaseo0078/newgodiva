# Calgary restriction verification

The previous banner inferred Stage 4 from inclusive dates in `data/config.js`.
Rules, fines, chatbot facts, the popup, translations and neighbour cards assumed
Stage 4. `/api/news` retrieves CBC headlines, not official restriction status.
The community-boundary and 311 Open Data APIs do not provide restriction status.

## Sources and rules

No documented current-stage API was identified in Calgary's public Open Data
search or restriction guidance. The official guidance says restrictions are
announced through City communications. `/api/restrictions` therefore retrieves:

- https://www.calgary.ca/planning/water/bearspaw-feeder-main/water-restrictions.html
- https://www.calgary.ca/water/drought.html

It requires an explicit present-tense declaration, ignores future/historical
wording and scripts/navigation, and rejects conflicting current declarations.
One explicit declaration is sufficient if the other page is unavailable or has
no current declaration. The response lists only sources that supplied evidence.
Newsroom headlines and construction durations do not establish current status.
There is no AI inference or production stage override.

`data/restrictions.js` contains all five rule sets, reviewed November 8, 2026:

- Rules: https://www.calgary.ca/water/drought/outdoor-water-restrictions.html
- Normal schedule: https://www.calgary.ca/water/drought/lawn-watering-schedule.html
- Fines, Schedule B: https://www.calgary.ca/content/dam/www/uep/water/documents/water-documents/40M2006-water-utility-office-consolidation.pdf
- Stage 4 exceptions: the feeder-main restriction page above.

No Restrictions means no temporary restriction stage. Calgary's normal watering
schedule still applies. Stage fines are $400, $600, $1,500 and $3,000; the normal
watering-schedule fine can be $200. The model preserves edible-crop, establishment,
water-managed-site, health/safety, livestock and commercial-plant exceptions.
Rules are curated from official guidance, not automatically rewritten by a
scraper. Review this model when the City changes its bylaws or guidance.

## Updating and failures

Successful verification is cached for 15 minutes. Requests have an 8-second
timeout per official page; checks run concurrently. Failed verification retries
after a one-minute backoff. The browser requests status on startup, every five
minutes, and after connectivity returns. Opening a page does not change the
original verification timestamp on a cached response.

The server keeps its last successful snapshot in memory and the operating
system's temporary directory. For persistence across Vercel cold starts and
instances, configure a dedicated Upstash Redis REST database with these
**server-only** environment variables:

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

The cache key is `dropwise:restrictions:v1`, with no automatic expiry, so an
outage cannot erase the last verification. Cache failures do not prevent live
verification. Without Redis, server cache persistence is best-effort: a cold
instance may have no snapshot. Browsers separately retain their last verified
response in localStorage and mark it stale until refreshed. With no verified
snapshot anywhere, the UI shows **Status unavailable**, never a default stage.
Deployments should configure Redis to retain verification for new visitors
during source outages. Existing Supabase tables and permissions are unchanged.

The API exposes `stage` (0–4 or null), `verifiedAt`, `checkedAt`, `nextCheckAt`,
`stale`, `warning`, `sources`, the applicable rules, and nullable effective dates.
It sends `Cache-Control: no-store`; freshness is controlled by the verification
cache so a CDN cannot hide a verification failure.

The banner, popup, cards, fines, hero kicker, offline restriction answers,
neighbour print/share cards and server chat grounding use the same stage model.
Dynamic rule text uses English; existing translations for unrelated features are
preserved. Old Stage 4 translations are not used for current restriction rules.

## Calendar

The calendar uses `data/restriction-calendar.js`, which contains the verified
archive and shared date-range resolution functions. Construction events remain
separate in `data/config.js`. All calendar date keys use America/Edmonton; month
grids use UTC calendar arithmetic so the viewer's timezone and DST cannot shift
dates. Navigating months/years makes no API requests.

Every record has `id`, `stage` (0–4), `start`, nullable `end`, `status`
(`confirmed`, `scheduled`, `estimated`, `unknown`), `source`, and `verifiedAt`.
`kind` distinguishes declarations from dated observations. `end` is populated
only for an officially confirmed end. `endsAt`/`startsAt` preserve known intraday
transitions. `estimatedThrough` supports explicitly estimated coverage without
setting an official end; `expectedDuration` can retain an approximate duration
without calculating any dates. `verifiedThrough` limits an open declaration's
confirmed coverage to the last verified Calgary date.

Verified archive coverage:

- July 17, 2024: Stage 3 observation.
- July 18 and July 22, 2024: Stage 2 observations. The earlier tentative July 22
  move to Stage 1 was not implemented; the actual July 22 announcement takes precedence.
- August 26, 2024: Stage 4 observation.
- March 9–April 2, 2026: confirmed Stage 4 range. The official lifting declaration
  takes effect April 2 at 9 a.m. Calgary time; April 2 shows a stage transition.
- April 2, 2026: No Restrictions observation after the lifting time. This is not
  extrapolated to the rest of spring/summer.
- November 4, 2026: confirmed Stage 4 start, open-ended. The verified declaration
  covers through November 7 Calgary time (reviewed November 8 UTC). Approximately
  four weeks remains a duration estimate; no December 1 end date is fabricated.

All source URLs and source verification timestamps are stored with each entry.
Historical rules may differ from today's stage guide: use the dated announcement
for the rules that applied at that time.

The complete 2024/2025/2026 timeline is **not verified**. In particular, no complete
Stage 1 timeline or uninterrupted April–November 2026 Stage 0 interval is claimed.
Gaps say **Historical data unavailable**. Future dates lacking explicit scheduled
or estimated coverage say **No official restriction announcement for this date**.
An open-ended declaration is also shown as an advisory, so unknown future dates
are never presented as evidence that an ongoing declaration has ended.

Overlapping contradictory stages show uncertainty unless explicit effective
times establish a transition. Live source conflicts remain visible as current
uncertainty while retaining the last verified banner stage. Outdated open-period
information is marked stale; immutable closed historical ranges do not expire.

Archive entries are curated from official announcements and must be reviewed
when the City publishes effective-date changes. Current-stage checks automatically
retain dated observations; they never manufacture past effective ranges or close
open declarations when a different current stage is observed. An observation's
`start` is its coverage/observation date, not an inferred legal start date.

Construction windows remain explicitly tentative. Archived November notices
retain their original date and are labelled archived.

## Durable history and presentation

The existing Upstash server-only variables also enable the Redis hash
`dropwise:restriction-history:v1`. It has no TTL. Each Calgary date/stage has its
own field; later verification can refresh that field's timestamp, but changing
stage never overwrites records for another stage or date. This bounds remote
history to at most five observations per day. Updates use individual hash fields
to avoid losing unrelated records when two server instances write concurrently.
The source archive is bundled with the code and survives deployments independently.

Memory, an append-only temporary JSONL log, and browser localStorage provide
fallback history. Configure Redis for reliable observation retention across
Vercel cold starts/deployments and new browsers. API `history.storage` reports
`durable` or `temporary`, with a visible warning on storage failures or missing
configuration. Storage credentials remain server-only. No Supabase migration is
required. The same status response includes the history; month navigation never
fetches data per day or per month.

Rule cards show 3–5 key rules total, followed by expandable activity groups and
all legal exceptions. Fines are linked to prohibited activities and the official
fine schedule. The banner popup has five independently browsable stage buttons;
exploring a guide does not change the live banner, active cards, or verification.

## Local testing (Node 20+)

Run the automated parser, cache and UI-rendering tests:

```
npm.cmd test
```

On non-Windows shells, `npm test` is equivalent. UI tests exercise the actual
render functions with a minimal DOM; they are not browser layout tests.

Preview each status without API keys or external requests:

```
node scripts/restrictions-dev.mjs 0
node scripts/restrictions-dev.mjs 1
node scripts/restrictions-dev.mjs 2
node scripts/restrictions-dev.mjs 3
node scripts/restrictions-dev.mjs 4
```

Run one command at a time, visit http://127.0.0.1:3000, choose guest access,
and check the banner, popup, rule lists, fine, calendar and neighbour card.
Stop the server with Ctrl+C before switching fixtures. Fixture 0 is No
Restrictions. `stale` displays a day-old Stage 2 snapshot; `unknown` displays
unavailable status when browser cache is empty. Clear only localStorage key
`dw_verified_restrictions_v1` to test an empty cache without deleting household
records. With a browser snapshot present, `unknown` should preserve it as stale.

Omit the argument for live official-page verification:

```
node scripts/restrictions-dev.mjs
```

This loopback-only preview serves static assets and the restriction endpoint.
Other APIs are not implemented by this preview. For the complete existing app
and all integrations, use `vercel dev` with your existing server environment
variables. Inspect `/api/restrictions` to see timestamps, stage and sources.
No fixture override is included in the deployed API.

For an outage check, load a verified status, then take the browser offline and
wait for the next poll (or reload). The last verified stage must remain visible
with a stale warning and unchanged verification time. The automated suite also
tests server-cache recovery after a restart, source conflicts and malformed
responses. No deployment or Git push is required for these checks.
