/*
 * DropWise YYC — editable data & settings.
 * Everything the team may need to update lives in this one file.
 * Keep City notices and calendar events REAL (copy from official City of Calgary pages)
 * and keep the source link on each item.
 */
window.DW_CONFIG = {
  city: { name: "Calgary", lat: 51.0447, lon: -114.0719, timezone: "America/Edmonton" },

  // Default daily goal per person (litres). Editable by the user in Settings.
  // TODO(team): replace with a figure you can cite (e.g. City target ÷ population served) and update the note.
  defaultPerPersonLitres: 150, // fallback only; the StatCan Alberta average is used when available
  perPersonNote: "Default goal you can change in Settings. Replace with a City-based figure before judging.",

  // Online database + accounts (Supabase). Paste your project's URL and anon (public) key to turn on
  // households shared across devices. Leave empty to run in local mode (data stays in this browser).
  supabaseUrl: "https://zcizjxurwyypbwsrcwjw.supabase.co",
  supabaseAnonKey: "sb_publishable_dGml3tSBb9N-RIUJXknrkA__MssoDd9",
  rankingMinHouseholds: 1, // raise to 3+ for real use so a single home's numbers can't be singled out

  // Google Sign-In (optional): paste an OAuth 2.0 Web client ID from Google Cloud Console to turn on "Continue with Google".
  googleClientId: "",
    googleMapsApiKey: "",
    

  // Quick-add buttons. Litres from the City of Calgary Stage 4 page unless marked "estimate".
  activities: [
    { id: "shower",     label: "Shower (3 min)", icon: "🚿", category: "washroom",   litres: 28.5, perMinute: 9.5, note: "3-minute shower (City's ask) with a regular shower head: 47.5 L per 5 min = 9.5 L/min (City of Calgary). Low-flow: 7.6 L/min." },
    { id: "laundry",    label: "Laundry load",   icon: "👕", category: "laundry",    litres: 62,  note: "Front-load washer: 62 L per cycle; top-load 112 L (City of Calgary)." },
    { id: "dishwasher", label: "Dishwasher",     icon: "🍽️", category: "dishwasher", litres: 28,  note: "Dishwasher: 28 L per load (City of Calgary)." },
    { id: "toilet",     label: "Flush",          icon: "🚽", category: "washroom",   litres: 6,   note: "Standard toilet: 6 L per flush; low-flow 4.8 L (City of Calgary)." },
    { id: "bath",       label: "Bath",           icon: "🛁", category: "washroom",   litres: 92,  note: "Typical bathtub: 92 L (City of Calgary)." },
    { id: "other",      label: "Other",          icon: "💧", category: "extra",      litres: 20,  note: "Cooking, cleaning, drinking — estimate." },
    { id: "meter-gap",  label: "Meter gap",      icon: "📏", category: "extra",      litres: 0,   note: "Difference between your meter and your log.", hidden: true }
  ],

  // The City asks Calgarians to keep showers to about 3 minutes during Stage 4.
  showerGoalSeconds: 180,

  // City-wide supply. Update usedML from the City's daily water usage dashboard / calgary.ca before demoing.
  cityUsage: {
    usedML: 490, targetML: 500, label: "Latest daily use shown on calgary.ca (checked Nov 7, 2026)",
    source: "https://www.calgary.ca/planning/water/bearspaw-feeder-main/water-restrictions.html"
  },

  // Stage 4 rules — from the City of Calgary Stage 4 page. Keep wording close to the official page.
  stage4: {
    source: "https://www.calgary.ca/planning/water/bearspaw-feeder-main/water-restrictions.html",
    fine: "Fines start at $3,000",
    notAllowed: [
      "Watering lawns, gardens, trees and shrubs — by any method, including new grass and plants",
      "Making outdoor ice or snow, including flooding backyard or community rinks",
      "Washing cars with a hose on your driveway or street",
      "Washing sidewalks, driveways, walkways, building surfaces or windows (health and safety exceptions)",
      "Filling outdoor pools, hot tubs, wading pools, fountains or decorative water features",
      "Using water for construction or renovation, or testing irrigation systems"
    ],
    allowed: [
      "Washing your car at an indoor car wash (only when needed for safety is encouraged)",
      "Watering edible food crops with a spring-loaded hose nozzle or a hand-held container",
      "Filling bird baths and residential ponds",
      "Water for livestock, and plants grown for sale or donation"
    ],
    indoorAsks: [
      "Keep showers to about 3 minutes — each minute saved can save up to 8 L",
      "Run washing machines and dishwashers only with full loads",
      "Flush only when needed — skipping five flushes saves about 25 L",
      "Shower every two days instead of daily; keep baths shallow",
      "Turn off the tap while lathering, brushing teeth or shaving",
      "Turn off water softeners and humidifiers; fix leaky taps and toilets"
    ]
  },


  categories: [
    { id: "washroom",   label: "Washroom",   color: "#1e6fe0" },
    { id: "dishwasher", label: "Dishwasher", color: "#14b886" },
    { id: "laundry",    label: "Laundry",    color: "#f5a000" },
    { id: "extra",      label: "Extra",      color: "#9a7bf7" }
  ],

  // Calendar events (inclusive dates). "approx: true" shows "≈" because the City gave approximate durations.
  events: [
    { title: "Stage 4 water restrictions", type: "restriction", start: "2026-03-09", end: "2026-04-01",
      detail: "Feeder main reinforcement work. Restrictions were lifted April 2, 2026.",
      source: "https://newsroom.calgary.ca/water-restrictions-lifted-as-bearspaw-south-feeder-main-returns-to-service/" },
    { title: "Stage 4 water restrictions", type: "restriction", start: "2026-11-04", end: "2026-12-01", approx: true,
      detail: "Connecting the new Bearspaw South Feeder Main (about four weeks; no end date announced yet). Stage 4 outdoor restrictions, and the city must stay below 500 million litres a day.",
      source2: "https://www.calgary.ca/planning/water/bearspaw-feeder-main/water-restrictions.html",
      source: "https://www.calgary.ca/content/dam/www/is/utilities-delivery/bearspaw-feeder-main/documents/october-22-construction-notice.pdf" },
    { title: "Feeder main draining (33 Ave N.W.)", type: "construction", start: "2026-11-04", end: "2026-11-07", approx: true,
      detail: "The existing feeder main is drained before tie-in construction (about four days).",
      source: "https://www.calgary.ca/content/dam/www/is/utilities-delivery/bearspaw-feeder-main/documents/october-22-construction-notice.pdf" },
    { title: "24-hour construction: 33 Ave & 89 St N.W.", type: "construction", start: "2026-11-14", end: "2026-11-23", approx: true,
      detail: "Intersection fully closed. 24-hour construction for about 10 days.",
      source: "https://www.calgary.ca/content/dam/www/is/utilities-delivery/bearspaw-feeder-main/documents/october-22-construction-notice.pdf" },
    { title: "New feeder main commissioning", type: "info", start: "2026-12-02", end: "2026-12-31", approx: true,
      detail: "Commissioning in December 2026 — the City says no water restrictions for this step. (Exact dates TBC.)",
      source: "https://www.calgary.ca/emergencies/critical-water-main-break-june-2024/make-every-drop-count.html" }
  ],

  // Official notices shown as BLACK mail in the inbox.
  notices: [
    { id: "n0", date: "2026-11-04", title: "Stage 4: outdoor watering is banned — fines start at $3,000",
      body: "No watering lawns, gardens, trees or shrubs, no rink flooding, no driveway car washing. Keep the city under 500 million litres a day. Questions? Call 311.",
      source: "https://www.calgary.ca/planning/water/bearspaw-feeder-main/water-restrictions.html" },
    { id: "n1", date: "2026-11-04", title: "Stage 4 water restrictions are in effect",
      body: "While the new Bearspaw South Feeder Main is connected (about four weeks), city-wide Stage 4 outdoor water restrictions and voluntary indoor water conservation are required.",
      source: "https://www.calgary.ca/content/dam/www/is/utilities-delivery/bearspaw-feeder-main/documents/october-22-construction-notice.pdf" },
    { id: "n2", date: "2026-11-04", title: "Feeder main draining along 33 Avenue N.W.",
      body: "Before tie-in construction can begin, the existing feeder main is being drained (about four days).",
      source: "https://www.calgary.ca/content/dam/www/is/utilities-delivery/bearspaw-feeder-main/documents/october-22-construction-notice.pdf" },
    { id: "n3", date: "2026-11-14", title: "24-hour construction at 33 Ave & 89 St N.W.",
      body: "The intersection will be fully closed. 24-hour construction is expected to begin November 14 for about 10 days.",
      source: "https://www.calgary.ca/content/dam/www/is/utilities-delivery/bearspaw-feeder-main/documents/october-22-construction-notice.pdf" }
  ],

  // Facts the chatbot may rely on. Paste the official Stage 4 rule list here before judging.
  ruleFacts: [
    "City-wide Stage 4 outdoor water restrictions took effect November 4, 2026, while the new Bearspaw South Feeder Main is connected (about four weeks). No end date has been announced. Commissioning in December is not expected to need restrictions.",
    "The city must keep water use below 500 million litres (ML) per day (green zone). Above 500 ML is the red zone: risk of not enough water for firefighting, low pressure, a possible boil water advisory, or system failure.",
    "During the shutdown, Glenmore Water Treatment Plant supplies about 80% of the water and Bearspaw about 20%.",
    "NOT allowed under Stage 4: watering lawns, gardens, trees and shrubs by any method (including new grass/plants); outdoor ice or snow making including flooding rinks; washing cars with driveway or street water; washing sidewalks, driveways, walkways, outdoor parkades, building surfaces or windows (health and safety exceptions); construction or renovation water use; testing irrigation systems; filling fountains or decorative water features; filling outdoor pools, hot tubs or wading pools.",
    "ALLOWED any day, any time: washing cars at indoor car washes (only when needed for safety is encouraged); watering edible food crops with a spring-loaded hose nozzle or hand-held container; watering plants for commercial sale or donation; water for livestock; bird baths and residential ponds. Indoor pools may operate.",
    "Indoor asks: keep showers to about 3 minutes (each minute saved can save up to 8 L); shower every two days; keep baths shallow; full loads only for washing machines and dishwashers; use eco settings; flush only when needed (skipping five flushes saves about 25 L); turn off the tap while lathering, brushing teeth or shaving; turn off water softeners and humidifiers; fix leaks.",
    "City water-use figures: front-load washer 62 L per cycle, top-load 112 L; dishwasher 28 L per load; low-flow toilet 4.8 L, standard toilet 6 L per flush; regular shower head 47.5 L per 5 minutes, low-flow 38 L; typical bath 92 L.",
    "Violations may result in fines starting at $3,000. Questions: 311.",
    "Frozen pipes: the City advises keeping the heat at 15°C or higher and opening cabinet doors near pipes. Homes that had frozen pipes before, or that received a City letter, may be asked to keep a pencil-thin stream of water running.",
    "Alberta's electricity grid peaks between 4 p.m. and 7 p.m. During cold snaps, AESO asks people to avoid running dishwashers and laundry in that window.",
    "DropWise runs a weekly Quadrant Water Challenge (NW, NE, SW, SE): households share their daily litres per person from water-meter readings; the quadrant with the lowest average wins. Discord members can type e.g. 'NW 165' in #water-challenge.",
    "Official info: calgary.ca/savewater and 311. DropWise is a community project, not an official City of Calgary service."
  ],

  // Fallback community list (with quadrant) if the City Open Data map API is unreachable.
  fallbackCommunities: [
    { name: "Beltline", q: "SW" }, { name: "Bowness", q: "NW" }, { name: "Bridgeland/Riverside", q: "NE" },
    { name: "Evanston", q: "NW" }, { name: "Forest Lawn", q: "SE" }, { name: "Mahogany", q: "SE" },
    { name: "Mission", q: "SW" }, { name: "Montgomery", q: "NW" }, { name: "Saddle Ridge", q: "NE" },
    { name: "Signal Hill", q: "SW" }, { name: "Tuscany", q: "NW" }, { name: "Varsity", q: "NW" }
  ],

  // Quadrant boundaries (approximate): E/W = Centre Street (north) / Macleod Trail (south);
  // N/S = Bow River west of downtown, then Centre Avenue / Memorial Drive east.
  quadrants: {
    names: { NW: "Northwest", NE: "Northeast", SW: "Southwest", SE: "Southeast" },
    ewLonNorth: -114.0627, ewLonSouth: -114.0660,
    river: [[-114.32, 51.115], [-114.22, 51.095], [-114.17, 51.08], [-114.14, 51.066], [-114.11, 51.057], [-114.085, 51.054], [-114.0627, 51.0490], [-113.80, 51.0470]]
  },

  // Discord community. Fill in after creating your server (see README → Discord setup).
  discord: {
    guildId: "",                      // Server ID (Server Settings → Widget → enable "Server Widget", copy Server ID)
    inviteUrl: "",                    // e.g. https://discord.gg/xxxx (create a never-expiring invite)
    channels: [
      { id: "", name: "water-tips",       icon: "💡", desc: "Share what works in your home to save water." },
      { id: "", name: "help-a-neighbour", icon: "🤝", desc: "Ask for or offer help — checking on seniors, explaining the rules, frozen-pipe worries." },
      { id: "", name: "water-challenge",  icon: "🗺️", desc: "Quadrant challenge: daily litres per person by NW, NE, SW and SE." },
      { id: "", name: "city-alerts",      icon: "📢", desc: "Official City of Calgary notices, re-posted (read-only)." }
    ]
  },

  // Statistics Canada table used for the "Alberta average" benchmark.
  statcan: { productId: 38100271, table: "38-10-0271-01", url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3810027101" },

  // City of Calgary Open Data: 311 Service Requests (water-service types start with "WATS -").
  open311: { dataset: "iahh-g8bj", prefix: "WATS", days: 30 },

  // DEMO quadrant ranking — shown with a "Demo data" banner only until the Discord bot is connected.
  demoRanking: {
    totals: { reports: 86, quadrants: 4 },
    quadrants: [
      { q: "NW", lpd: 168, reports: 27, change: -6 },
      { q: "SW", lpd: 176, reports: 22, change: -4 },
      { q: "NE", lpd: 189, reports: 18, change: -2 },
      { q: "SE", lpd: 204, reports: 19, change: 3 }
    ]
  }
};
