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

  categories: [
    { id: "washroom",   label: "Washroom",   color: "#1e6fe0" },
    { id: "dishwasher", label: "Dishwasher", color: "#14b886" },
    { id: "laundry",    label: "Laundry",    color: "#f5a000" },
    { id: "extra",      label: "Extra",      color: "#9a7bf7" }
  ],

  // Calendar events (inclusive dates). "approx: true" shows "≈" because the City gave approximate durations.
  events: [
    { title: "Feeder main draining (33 Ave N.W.)", type: "construction", start: "2026-11-04", end: "2026-11-07", approx: true,
      detail: "The existing feeder main is drained before tie-in construction (about four days).",
      source: "https://www.calgary.ca/content/dam/www/is/utilities-delivery/bearspaw-feeder-main/documents/october-22-construction-notice.pdf" },
    { title: "24-hour construction: 33 Ave & 89 St N.W.", type: "construction", start: "2026-11-14", end: "2026-11-23", approx: true,
      detail: "Intersection fully closed. 24-hour construction for about 10 days.",
      source: "https://www.calgary.ca/content/dam/www/is/utilities-delivery/bearspaw-feeder-main/documents/october-22-construction-notice.pdf" },

  ],

  // Official notices shown as BLACK mail in the inbox.
  notices: [
    { id: "n0", date: "2026-11-04", title: "Archived Nov 4 notice: Stage 4 restrictions",
      body: "No watering lawns, gardens, trees or shrubs, no rink flooding, no driveway car washing. Keep the city under 500 million litres a day. Questions? Call 311.",
      source: "https://www.calgary.ca/planning/water/bearspaw-feeder-main/water-restrictions.html" },
    { id: "n1", date: "2026-11-04", title: "Archived Nov 4 notice: Stage 4 announced",
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
    "Restriction status is supplied by the verified server-side restriction service. Do not infer the stage from construction dates.",
    "Restrictions regulate outdoor water use. Indoor conservation advice does not prohibit essential drinking, hygiene or medical water.",
    "City figures: front-load laundry 62 L; top-load 112 L; dishwasher 28 L; standard toilet 6 L; low-flow 4.8 L; typical bath 92 L. Regular shower heads use 47.5 L per five minutes; low-flow 38 L.",
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
    guildId: "1568738413190844438",                      // Server ID (Server Settings → Widget → enable "Server Widget", copy Server ID)
    inviteUrl: "https://discord.gg/KHkW7hcxcK",                    // e.g. https://discord.gg/xxxx (create a never-expiring invite)
    channels: [
      { id: "1568738507969527868", name: "water-updates",       icon: "📢", desc: "Stay updated on Calgary water restrictions and important announcements." },
      { id: "1568738542178537715", name: "water-saving-tips", icon: "💡", desc: "Share practical tips to save water at home." },
      { id: "1568738568837275838", name: "weekly-challenge",  icon: "🏆", desc: "Join our weekly water-saving challenge and compare your progress." }
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
