// POST /api/chat — DropBot answers using Google Gemini, grounded in the site's live context.
// Needs GEMINI_API_KEY in the hosting environment.
// Optional: GEMINI_MODEL (default gemini-3.5-flash) and GEMINI_FALLBACK_MODEL (default gemini-3.8-flash).
// The API key is read on the server only and never reaches the browser.
// Body: { messages: [{ role: "user"|"assistant", content }], context?: {...} }
// Reply: 200 { reply } | 4xx/5xx { error, code } where code is one of:
//   bad_request, not_configured, rate_limited / busy (both with Retry-After), blocked, unavailable

import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { getRestrictions } from "../lib/restrictions.mjs";

// Primary model, then one fallback if it's busy, rate-limited, unavailable or retired.
// (gemini-2.5-flash is no longer offered to new API keys; 3.5 Flash answers fastest in our tests.)
const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_FALLBACK_MODEL = "gemini-3.8-flash";
const TIMEOUT_MS = 15_000; // per model — two attempts stay inside the 60 s Vercel limit
export const modelChain = () => [...new Set([process.env.GEMINI_MODEL || DEFAULT_MODEL, process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL].filter(Boolean))];
const LANGUAGES = { en: "English", ko: "Korean", zh: "Simplified Chinese", hi: "Hindi", ar: "Arabic" };

// Re-use the same facts the website shows (data/config.js) so answers stay consistent.
function loadConfig() {
  try {
    const src = fs.readFileSync(path.join(process.cwd(), "data", "config.js"), "utf8");
    const window = {};
    new Function("window", src)(window);
    return window.DW_CONFIG || { ruleFacts: [], events: [] };
  } catch { return { ruleFacts: [], events: [] }; }
}

// One client per server instance. Our own fetch wrapper keeps network calls on the standard global fetch.
let client = null, clientKey = null;
function gemini(key) {
  if (!client || clientKey !== key) {
    // No SDK-level retries: the fallback model is the retry, which keeps the worst case short.
    client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: TIMEOUT_MS, retryOptions: { attempts: 1 }, fetch: (...a) => globalThis.fetch(...a) } });
    clientKey = key;
  }
  return client;
}

/** Tries each model in order; moves on only for errors another model might not have (busy, quota, outage, model retired). */
export async function generateWithFallback(ai, models, request) {
  let lastError;
  for (const model of models) {
    try { return await ai.models.generateContent(request(model)); }
    catch (e) {
      lastError = e;
      const status = Number(e?.status || 0), code = classifyError(e).code;
      if (!(status === 404 || code === "busy" || code === "rate_limited" || code === "unavailable")) throw e;
    }
  }
  throw lastError;
}

/** Last 10 turns, user/assistant only, mapped to Gemini roles; consecutive turns from the same side are merged. */
export function toGeminiContents(messages) {
  const turns = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.content.slice(0, 2000) }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  const out = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.parts[0].text += "\n\n" + t.text;
    else out.push({ role: t.role, parts: [{ text: t.text }] });
  }
  return out;
}

export function buildSystemPrompt({ config: C, restrictions, context }) {
  const ctx = context && typeof context === "object" ? context : {};
  const siteLanguage = LANGUAGES[ctx.siteLanguage] || "English";
  return `You are DropBot, the assistant on DropWise YYC, a website that helps Calgary households save water during water restrictions.

LANGUAGE:
- Reply in the language of the user's latest message. DropWise supports English, Korean (한국어), Simplified Chinese (中文), Hindi (हिन्दी) and Arabic (العربية).
- If the language is unclear (e.g. only numbers or a single word), reply in ${siteLanguage}, the language the site is set to.
- Keep official names in English where useful (e.g. "Stage 4", "311", "calgary.ca/savewater").

FACTS YOU MAY RELY ON (from official City of Calgary and AESO sources):
${(C.ruleFacts || []).map((f) => "- " + f).join("\n")}

VERIFIED RESTRICTION STATUS (from the server's check of official City pages — authoritative over the user's context and historical notices):
${JSON.stringify(restrictions)}
- If "stage" is null or the status is unavailable, say the current stage could not be verified and point to calgary.ca/savewater or 311.
- If "stale" is true, mention when it was last verified ("verifiedAt").
- Never infer the current stage, a start date or an end date from the calendar, past notices or the user's context.

CALENDAR (official dates; "approx." means the City gave an approximate duration):
${(C.events || []).map((e) => `- ${e.title}: ${e.start} to ${e.end || "no confirmed end date"}${e.approx ? " (approx.)" : ""}. ${e.detail || ""}`).join("\n")}

THIS USER'S LIVE CONTEXT (from the website):
${JSON.stringify(ctx, null, 1).slice(0, 4000)}
How to read it:
- "measuredTodayLitres" comes from the user's water-meter readings (measured). null means there is no measured total for today.
- "meterAverageLast7Days" is a time-weighted average from meter readings. null means not enough readings.
- "estimatedTodayLitres" and "usedByCategory" are ESTIMATES from tapped buttons and the shower timer — always call them estimates.
- "quadrantRanking" with "demo": true is sample data, not real reports.
- Never state a usage number, meter reading or ranking that is not in this context. If it's missing, say so and explain how to record it.

THE DROPWISE WEBSITE (for "how do I…" questions):
- Today's usage: quick-add buttons and a shower timer give estimates; "Water meter reading" is the measured total — type the number on the meter, pick m³ or ft³ and the time, then Save reading. DropWise turns the difference between readings into litres per day and per person. A lower reading can be saved as "meter replaced or reset".
- Water restrictions: what's not allowed outdoors, what's still allowed, and indoor tips. Restriction & construction calendar: restriction periods, household goals and construction views.
- Shower challenge: a timer with progress and recent showers.
- Quadrant Water Challenge: optional — tick "Join the quadrant challenge" under the meter reading to share litres per person (no name or address). Households share through "Our household".
- Calgary Water Community (Discord): tips, 311 water issues nearby, and checking on a neighbour.
- Settings (⚙️): household size, per-person goal and community. Language menu: English, 한국어, 中文, हिन्दी, العربية.

RULES:
- Use plain, friendly words. Keep answers under 120 words unless asked for more.
- Do the maths for the user when asked (e.g. household goal = people × per-person goal). Show the numbers. 1 m³ = 1,000 L.
- Balance advice: saving water (restrictions), avoiding the 4–7 p.m. power peak, and frozen-pipe safety (running a pencil-thin stream is only for homes at risk).
- Never invent rules, fines, dates, restriction stages or water measurements that are not given above. If unsure, say so and point to calgary.ca/savewater or 311.
- You give general guidance, not official City advice.`;
}

/** Maps Gemini/SDK/network errors to a safe status + code. Never forwards provider messages or keys. */
export function classifyError(e) {
  const status = Number(e?.status || e?.code || 0), msg = String(e?.message || "");
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) return { http: 429, code: "rate_limited", error: "DropBot is busy right now. Please try again in a minute." };
  if (status === 503 || /UNAVAILABLE|overloaded|high demand/i.test(msg)) return { http: 503, code: "busy", error: "DropBot is busy right now. Please try again in a minute." };
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(msg)) return { http: 503, code: "not_configured", error: "DropBot isn't set up correctly on the server." };
  return { http: 502, code: "unavailable", error: "The AI service is unavailable right now." };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: "GEMINI_API_KEY is not set on the server.", code: "not_configured" });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch { body = {}; } }
  const contents = toGeminiContents(body.messages);
  if (!contents.length || contents[contents.length - 1].role !== "user") return res.status(400).json({ error: "No question", code: "bad_request" });

  let restrictions;
  try { restrictions = await getRestrictions(); }
  catch { restrictions = { stage: null, status: "unavailable", note: "The official restriction status could not be checked right now." }; }

  const systemInstruction = buildSystemPrompt({ config: loadConfig(), restrictions, context: body.context });
  res.setHeader("Cache-Control", "no-store");
  try {
    const response = await generateWithFallback(gemini(key), modelChain(), (model) => ({
      model,
      contents,
      config: {
        systemInstruction,
        temperature: 0.4,
        maxOutputTokens: 1500, // room for any internal "thinking" plus a short answer (the prompt asks for under 120 words)
        // Gemini 2.5 Flash can skip thinking entirely — faster and cheaper. Newer models use their own defaults.
        ...(/gemini-2\.5-flash/i.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {})
      }
    }));
    const reply = String(response?.text || "").trim();
    if (!reply) {
      const blocked = response?.promptFeedback?.blockReason || /SAFETY|BLOCKLIST|PROHIBITED/.test(response?.candidates?.[0]?.finishReason || "");
      return blocked
        ? res.status(422).json({ error: "DropBot can't answer that. Please ask about water use, restrictions or the website.", code: "blocked" })
        : res.status(502).json({ error: "The AI service returned an empty answer.", code: "unavailable" });
    }
    return res.status(200).json({ reply });
  } catch (e) {
    const c = classifyError(e);
    if (c.code === "rate_limited" || c.code === "busy") res.setHeader("Retry-After", "30");
    return res.status(c.http).json({ error: c.error, code: c.code });
  }
}
