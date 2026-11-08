// POST /api/meter-read — reads the number on a water-meter photo with Claude (vision).
// Body: { image: <base64 JPEG, already shrunk in the browser>, mediaType: "image/jpeg" }
// Privacy: the image is only held in memory for this one request. It is never written to disk, logged or stored.
// Needs ANTHROPIC_API_KEY (optional ANTHROPIC_MODEL).

const MAX_BASE64 = 4_000_000; // ~3 MB image

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "AI reading is not configured on the server." });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  let image = typeof body.image === "string" ? body.image : "";
  const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(body.mediaType) ? body.mediaType : "image/jpeg";
  if (!image || image.length > MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(image)) return res.status(400).json({ error: "Please send one photo (max ~3 MB)." });

  const prompt = `This photo should show a residential water meter (Calgary, Canada).
Read the cumulative total register — the odometer-style digits or digital display.
Find the unit printed on the meter face: "m3"/"m³"/"cubic metres" → "m3"; "ft3"/"ft³"/"CU FT"/"cubic feet" → "ft3". If no unit is visible, use null.
Digits after the decimal point (often red, or on a separate smaller wheel) belong after the decimal point. Ignore small sweep hands and leak indicators.
Do not guess. If the photo is not a water meter or the digits are not clearly readable, return null for reading.
Reply with ONLY this JSON, nothing else:
{"reading": <number or null>, "unit": "m3" | "ft3" | null, "confidence": "high" | "medium" | "low", "note": "<max 12 words, plain English>"}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 150,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: prompt }
        ] }]
      })
    });
    image = null; // drop our reference to the photo right away
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: "AI service error" });
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const match = text.match(/\{[\s\S]*\}/);
    const out = match ? JSON.parse(match[0]) : {};
    const reading = typeof out.reading === "number" && isFinite(out.reading) && out.reading >= 0 && out.reading < 1e7 ? out.reading : null;
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      reading,
      unit: ["m3", "ft3"].includes(out.unit) ? out.unit : null,
      confidence: ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "low",
      note: String(out.note || "").slice(0, 100)
    });
  } catch {
    return res.status(502).json({ error: "AI service unavailable" });
  } finally {
    image = null;
  }
}
