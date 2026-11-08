// /api/discord — the website's bridge to the DropWise Discord server.
//   GET                      → latest posts from #water-tips (needs a bot token)
//   GET ?view=ranking        → weekly quadrant (NW/NE/SW/SE) ranking built from #water-challenge messages
//   POST {type:"tip", text, community}          → posts a tip to #water-tips (webhook)
//   POST {type:"usage", quadrant, lpd}          → posts a household's daily litres/person to #water-challenge (webhook)
// Environment variables (server only — never in front-end code):
//   DISCORD_BOT_TOKEN, DISCORD_FEED_CHANNEL_ID, DISCORD_CHALLENGE_CHANNEL_ID,
//   DISCORD_WEBHOOK_TIPS, DISCORD_WEBHOOK_CHALLENGE

const API = "https://discord.com/api/v10";
const clean = (s, n) => String(s || "").replace(/@(everyone|here)/gi, "@​$1").replace(/<@[!&]?\d+>/g, "").trim().slice(0, n);
const recent = new Map(); // naive per-IP rate limit (resets when the function cold-starts)

async function postWebhook(url, content, embeds) {
  const r = await fetch(url + "?wait=true", {
    method: "POST", headers: { "Content-Type": "application/json" },
    // allowed_mentions: none → nobody can ping @everyone through the website
    body: JSON.stringify({ username: "DropWise YYC", content, embeds, allowed_mentions: { parse: [] } })
  });
  return r.ok;
}

// Read up to `pages` × 100 messages from a channel, newest first, stopping at `sinceMs`.
async function readChannel(token, channel, sinceMs, pages = 5) {
  const out = []; let before = "";
  for (let i = 0; i < pages; i++) {
    const r = await fetch(`${API}/channels/${channel}/messages?limit=100${before ? "&before=" + before : ""}`, { headers: { Authorization: `Bot ${token}` } });
    if (!r.ok) throw new Error("Discord error " + r.status);
    const batch = await r.json();
    out.push(...batch);
    if (batch.length < 100 || new Date(batch[batch.length - 1].timestamp).getTime() < sinceMs) break;
    before = batch[batch.length - 1].id;
  }
  return out.filter((m) => new Date(m.timestamp).getTime() >= sinceMs);
}

// Two ways to enter the quadrant challenge:
//  1) the website posts an embed whose footer is "DW|q=<NW|NE|SW|SE>|lpd=<litres per person per day>"
//  2) a Discord member types e.g. "NW 165" (quadrant + litres per person) in #water-challenge
const QUADS = ["NW", "NE", "SW", "SE"];
function parseEntry(m) {
  const footer = m.embeds?.[0]?.footer?.text || "";
  const site = footer.match(/^DW\|q=(NW|NE|SW|SE)\|lpd=(\d+)/);
  if (m.webhook_id && site) return { q: site[1], lpd: +site[2] };
  const typed = String(m.content || "").match(/^\s*(NW|NE|SW|SE)\s+(\d{2,4})\s*(l|litres|liters)?\b/i);
  if (!m.webhook_id && !m.author?.bot && typed) return { q: typed[1].toUpperCase(), lpd: +typed[2] };
  return null;
}

function buildRanking(messages, now) {
  const WEEK = 7 * 864e5;
  const b = Object.fromEntries(QUADS.map((q) => [q, { thisWeek: [], lastWeek: [] }]));
  for (const m of messages) {
    const e = parseEntry(m); if (!e || e.lpd < 10 || e.lpd > 2000) continue;
    const age = now - new Date(m.timestamp).getTime();
    (age < WEEK ? b[e.q].thisWeek : b[e.q].lastWeek).push(e.lpd);
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const quadrants = QUADS.filter((q) => b[q].thisWeek.length).map((q) => {
    const tw = avg(b[q].thisWeek), lw = avg(b[q].lastWeek);
    return { q, lpd: tw, reports: b[q].thisWeek.length, change: lw ? Math.round(((tw - lw) / lw) * 100) : null };
  }).sort((x, y) => x.lpd - y.lpd); // lowest litres per person = rank 1
  return {
    totals: { reports: quadrants.reduce((s, x) => s + x.reports, 0), quadrants: quadrants.length },
    quadrants, updated: new Date(now).toISOString()
  };
}

export default async function handler(req, res) {
  if (req.method === "GET" && new URL(req.url, "http://x").searchParams.get("view") === "ranking") {
    const token = process.env.DISCORD_BOT_TOKEN, channel = process.env.DISCORD_CHALLENGE_CHANNEL_ID;
    if (!token || !channel) return res.status(503).json({ error: "Discord challenge channel not configured" });
    try {
      const now = Date.now();
      const msgs = await readChannel(token, channel, now - 14 * 864e5);
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json(buildRanking(msgs, now));
    } catch (e) { return res.status(502).json({ error: e.message }); }
  }

  if (req.method === "GET") {
    const token = process.env.DISCORD_BOT_TOKEN, channel = process.env.DISCORD_FEED_CHANNEL_ID;
    if (!token || !channel) return res.status(503).json({ error: "Discord bot not configured" });
    const r = await fetch(`${API}/channels/${channel}/messages?limit=10`, { headers: { Authorization: `Bot ${token}` } });
    if (!r.ok) return res.status(502).json({ error: "Discord error " + r.status });
    const msgs = await r.json();
    const posts = msgs.filter((m) => m.content).map((m) => ({
      author: m.webhook_id ? "DropWise YYC" : (m.author.global_name || m.author.username),
      text: clean(m.content, 500),
      time: m.timestamp
    }));
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({ posts });
  }

  if (req.method === "POST") {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "local";
    if (Date.now() - (recent.get(ip) || 0) < 30_000) return res.status(429).json({ error: "Please wait 30 seconds between posts." });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const community = clean(body.community, 60).replace(/\|/g, "/") || "Calgary";
    let ok = false;

    if (body.type === "tip") {
      const text = clean(body.text, 280);
      if (text.length === 0) return res.status(400).json({ error: "Please enter a tip." });
      if (!process.env.DISCORD_WEBHOOK_TIPS) return res.status(503).json({ error: "Tips webhook not configured" });
      ok = await postWebhook(process.env.DISCORD_WEBHOOK_TIPS, `💡 **Tip from a neighbour in ${community}:**\n${text}`);
    } else if (body.type === "usage") {
      const q = String(body.quadrant || "").toUpperCase(), lpd = Math.round(+body.lpd);
      if (!QUADS.includes(q) || !(lpd >= 10 && lpd <= 2000)) return res.status(400).json({ error: "Invalid usage report." });
      if (!process.env.DISCORD_WEBHOOK_CHALLENGE) return res.status(503).json({ error: "Challenge webhook not configured" });
      // Only the quadrant is posted — no name, address or community.
      ok = await postWebhook(process.env.DISCORD_WEBHOOK_CHALLENGE,
        `💧 A household in **${q}** Calgary used **${lpd} L per person** today.`,
        [{ color: 0x1673cf, footer: { text: `DW|q=${q}|lpd=${lpd}` } }]);
    } else return res.status(400).json({ error: "Unknown post type" });

    if (!ok) return res.status(502).json({ error: "Discord rejected the post." });
    recent.set(ip, Date.now());
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}
