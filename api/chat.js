// POST /api/chat — DropBot answers using Claude, grounded in the site's live context.
// Set ANTHROPIC_API_KEY in your hosting environment. Optional: ANTHROPIC_MODEL.
// The API key never reaches the browser.

import fs from "node:fs";
import path from "node:path";

// Re-use the same facts the website shows (data/config.js) so answers stay consistent.
function loadConfig() {
  try {
    const src = fs.readFileSync(path.join(process.cwd(), "data", "config.js"), "utf8");
    const window = {};
    new Function("window", src)(window);
    return window.DW_CONFIG;
  } catch { return { ruleFacts: [], events: [] }; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "ANTHROPIC_API_KEY is not set on the server." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const messages = (body.messages || [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!messages.length || messages[0].role !== "user") return res.status(400).json({ error: "No question" });

  const C = loadConfig();
  const system = `You are DropBot, the assistant on DropWise YYC, a website that helps Calgary households save water during water restrictions.

FACTS YOU MAY RELY ON (from official City of Calgary and AESO sources):
${C.ruleFacts.map((f) => "- " + f).join("\n")}

CALENDAR (official dates; "approx." means the City gave an approximate duration):
${C.events.map((e) => `- ${e.title}: ${e.start} to ${e.end}${e.approx ? " (approx.)" : ""}. ${e.detail}`).join("\n")}

THIS USER'S LIVE CONTEXT (from the website; litres are estimates from their activity log):
${JSON.stringify(body.context || {}, null, 1).slice(0, 4000)}

RULES:
- Answer in the same language the user writes in. Use plain, friendly words. Keep answers under 120 words unless asked for more.
- Do the maths for the user when asked (e.g. household goal = people × per-person goal). Show the numbers.
- Balance advice: saving water (restrictions), avoiding the 4–7 p.m. power peak, and frozen-pipe safety (running a pencil-thin stream is only for homes at risk).
- Never invent specific rules, fines or dates that are not in the facts above. If unsure, say so and point to calgary.ca/savewater or 311.
- You give general guidance, not official City advice.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 500, system, messages })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || "AI error" });
    const reply = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(502).json({ error: "AI service unavailable" });
  }
}
