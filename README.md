# DropWise YYC 💧

**Every drop counts in Calgary.** A website that helps Calgary households track their water use during water restrictions, see official City restriction and construction dates, build better habits with neighbours, and get answers from an AI assistant.

## Hackathon prompt fit — Prompt 1: health, social connection & well-being

> Calgary's water emergency isn't just an infrastructure problem — it's a community well-being problem. DropWise YYC helps households stay healthy, stay calm, and save water together.

| Prompt 1 | Where it is on the site |
|---|---|
| **Health** | *Stay healthy & calm → Essentials first*: drinking, cooking, hygiene and medical water are never the thing to cut. DropWise warns when a home drops below ~50 L per person per day (WHO: 50–100 L covers basic needs). |
| **Social connection** | *Our household* (shared records with family), *Together this week* (kudos, days within goal), *Quadrant challenge*, *Discord community*, *Check on a neighbour* (large-print card in 5 languages + text message). |
| **Well-being** | *How are you feeling?* check-in with calm, supportive replies (nothing saved), 24/7 help lines (Distress Centre Calgary 403-266-HELP, 211 Alberta, 311), positive-only feedback, plain-language Stage 4 rules. |

## Hackathon APIs used for health
- **WHO Global Health Observatory API** (`/api/health`) — % of Canadians with safely managed drinking water.
- **UN SDG API** (`/api/health`) — Goal 6.1.1, share of the world's population with safe drinking water.
- **Open Data Canada (CKAN API)** (`/api/health`) — latest Government of Canada datasets on drinking water.
- **Statistics Canada WDS** (`/api/statcan`) — Alberta home water use per person.
- **Open Referral (HSDS)** — local support directory in `data/services.json` (Distress Centre, 988, Health Link 811, 211, 311).
- **Discord API** — community feed, tips and quadrant challenge.
No keys are needed for the first five. Results are cached for a day; if a source is down, the card says so and the rest still works.

## Features
| Section | What it does | Data |
|---|---|---|
| Alerts inbox | ⚫ City notices, 🔴 personal over-use warnings, 📰 local water news | City of Calgary notices (curated in `data/config.js`), CBC Calgary RSS (`/api/news`) |
| Today's usage | Water tank (green → yellow → red), big litres number with editable daily goal, donut by category; quick-add buttons (shower, laundry, dishwasher, flush, bath, other); **Undo / Redo** backup (also Ctrl+Z / Ctrl+Y) and a removable log | City of Calgary per-activity figures; your log (browser only) |
| Water meter | 📷 Scan a meter photo → AI fills the reading (photo shrunk in the browser, sent once, never stored), or type it; *Save & reconcile* puts any gap under "Extra" | Claude vision (`/api/meter-read`) |
| Calendar | Restriction & construction dates + whether you met your goal each day | City of Calgary (curated, with source links) |
| Shower timer | 3-minute goal (City advice), history, streaks — stays on this device | Your showers |
| Quadrant Water Challenge | Calgary map coloured by NW/NE/SW/SE (red = highest litres per person), weekly ranking | City of Calgary Open Data map API (Community District Boundaries GeoJSON) + opt-in reports via Discord #water-challenge (`/api/discord?view=ranking`) |
| Calgary Water Community | Discord server card (online count, join button, channels), live #water-tips feed, post a tip, share shower wins | Discord Widget API, Discord bot + webhooks (`/api/discord`) |
| 311 near you | Water-service requests in your community, last 30 days | City of Calgary Open Data — 311 Service Requests (`iahh-g8bj`) |
| Alberta benchmark | Average residential L/person/day for Alberta & Canada; used as the default daily goal | Statistics Canada WDS, Table 38-10-0271-01 (`/api/statcan`) |
| Ask DropBot | Chatbot that knows the rules, the calendar, your household and live data | Claude API (`/api/chat`) |

## Log in
`login.html` — email + password accounts or **Continue with Google**, plus *look around without logging in*. Each account's records are stored separately (key prefix per user).
- **Demo scope:** accounts live in this browser only (passwords stored as a salted SHA-256 hash). For a real launch, move to a hosted auth service (Firebase Auth / Supabase) so records follow the user across devices.
- **Google sign-in:** create an OAuth 2.0 *Web* client ID in Google Cloud Console, add your site URL (and `http://localhost:3000`) to *Authorized JavaScript origins*, and paste the ID into `googleClientId` in `data/config.js`. One Tap auto sign-in turns on automatically. In production, verify the Google token on a server.

## Water meter
Type the number on the meter (decimals allowed), pick the unit (m³ or ft³), and the time you read it — or scan a photo and let AI fill the number and unit. Each reading is saved with its unit and time, converted to litres (1 m³ = 1,000 L, 1 ft³ = 28.3168 L), and compared with the previous reading.

## Run it
**Quick look (no server):** open `index.html` in a browser. Community names load live; Discord, news, StatCan and AI fall back to offline/demo mode.

**Full version (recommended for the demo):**
1. Install the Vercel CLI: `npm i -g vercel`
2. Add environment variables (Vercel dashboard → Settings → Environment Variables, or a local `.env` file):
   - `ANTHROPIC_API_KEY` — for DropBot and the meter-photo reader
   - `ANTHROPIC_MODEL` (optional)
   - `DISCORD_BOT_TOKEN`, `DISCORD_FEED_CHANNEL_ID`, `DISCORD_CHALLENGE_CHANNEL_ID`, `DISCORD_WEBHOOK_TIPS`, `DISCORD_WEBHOOK_CHALLENGE` — see Discord setup
3. Local: `vercel dev` → http://localhost:3000. Deploy: `vercel --prod`.

> Never put API keys in the front-end files or commit them to GitHub.

## Household ("Our home") & cloud sync — Supabase (about 20 minutes)

Without keys the site runs in **local mode** (records stay in this browser, household feature shows a note).
To share one household across family members and devices:

1. Create a free project at supabase.com.
2. SQL Editor → paste all of `supabase/schema.sql` → Run. (Safe to run again.)
3. Authentication → URL Configuration: set **Site URL** to your Vercel URL and add `https://YOUR-SITE/index.html` to Redirect URLs.
4. (Optional) Authentication → Providers → Google: paste a Google OAuth client ID/secret.
5. Project Settings → API: copy the **Project URL** and **anon public key** into `data/config.js` (`supabaseUrl`, `supabaseAnonKey`). The anon key is safe in the browser — Row Level Security protects the data. Never put the service_role key in the site.
6. `rankingMinHouseholds`: raise to 3–5 for the real launch so a quadrant only appears once several homes report (privacy).

How it works
- One account belongs to at most one household. The owner creates it (name, quadrant, people living there) and gets an 8-character invite code (e.g. `K7QM-2PXD`).
- Members share meter readings, activity logs, showers, the calendar and the chart; every record shows who added it.
- **Meter = measured total. Buttons/timer = estimates.** A day uses the meter number when readings exist; estimates are shown for reference and never added on top.
- Quadrant ranking is computed in the database: one value per household (meter litres ÷ people living there), whatever the number of accounts.
- "People living here" (for the goal) is separate from "members on DropWise" (accounts).
- Owner: edit details, new invite code (old one stops working), remove members, make someone else owner. Members: leave. The last person leaving deletes the household.
- Database rules (RLS) block any account from reading or changing another household's records; membership only changes through checked functions.

## Personal records in your account (no household needed)
When someone is logged in (Supabase), their records are saved to the database even if they haven't joined a household, so they see them on every device. Household members keep sharing household records as before; personal records are private to one account and never count in the quadrant ranking.
- Existing Supabase project: run `supabase/personal_records.sql` once in the SQL Editor **before** deploying this version (new projects get it from `schema.sql`).
- Records saved in a browser before logging in to the same account are copied into the account once.
- "Look around without logging in" still keeps records in that browser only.

## Discord setup (about 15 minutes)
1. Create a server, e.g. "DropWise YYC Community", with channels `#water-tips`, `#help-a-neighbour`, `#water-challenge`, `#city-alerts` (make #city-alerts read-only).
2. **Widget:** Server Settings → Widget → enable *Server Widget*. Copy the **Server ID** into `discord.guildId` in `data/config.js`. Create a never-expiring invite and put it in `discord.inviteUrl`.
3. **Channel links:** turn on Developer Mode (User Settings → Advanced), right-click each channel → Copy Channel ID → paste into `discord.channels[].id`.
4. **Webhooks (posting from the website):** Edit #water-tips → Integrations → Webhooks → New Webhook → copy URL → `DISCORD_WEBHOOK_TIPS`. Do the same for #water-challenge → `DISCORD_WEBHOOK_CHALLENGE`.
5. **Bot (reading the feed):** discord.com/developers → New Application → Bot → copy token → `DISCORD_BOT_TOKEN`. Turn on **Message Content Intent**. Invite it with the *View Channels* + *Read Message History* permissions. Put the #water-tips channel ID in `DISCORD_FEED_CHANNEL_ID` and the #water-challenge channel ID in `DISCORD_CHALLENGE_CHANNEL_ID`.
6. **Quadrant ranking:** households that tick *Join the quadrant challenge* share their daily litres per person (quadrant only — no name, address or community). Discord members can type `NW 165` in #water-challenge. Lowest average = rank 1; the highest-use quadrant is shown in red on the map.

Safety built in: website posts can't ping @everyone, are length-limited, rate-limited, and show only the community name.

## Before judging — checklist
- [ ] Check the StatCan benchmark loads (it becomes the default goal). `defaultPerPersonLitres` is only a fallback.
- [ ] Paste the official Stage 4 rule list into `ruleFacts`.
- [ ] Double-check every event date and source link against calgary.ca.
- [ ] Add sources for the litres-per-activity estimates.
- [ ] Before Discord is connected the ranking shows a **Demo data** banner — keep it until real data flows.

## Design
Glassmorphism: boxes (cards, buttons, dialogs) use a translucent fill + `backdrop-filter: blur()` + a light edge on the plain page background. Falls back to solid cards when the browser doesn't support it or the user prefers reduced transparency.

## Languages & text size
English, 한국어, 中文, हिन्दी, العربية (right-to-left) via the language menu — strings in `data/i18n.js`. Translations should be reviewed by native speakers; official City rules are in English. Text size: A− / A+ (100% → 115% → 130% → 145%).

## Accessibility & privacy
Keyboard navigable, skip link, larger-text toggle, warnings use icons + text (not colour alone), reduced-motion support, chatbot answers in the user's language. No accounts, no tracking — logs stay in the browser (localStorage).
