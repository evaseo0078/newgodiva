// GET /api/news — latest Calgary water-related headlines from the CBC Calgary RSS feed.
// Runs on the server because browsers block cross-site RSS requests (CORS).

const FEED = "https://www.cbc.ca/webfeed/rss/rss-canada-calgary";
const KEYWORDS = /water|feeder main|bearspaw|restriction|frozen pipe|drought/i;

const pick = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m ? m[1].trim() : "";
};

export default async function handler(req, res) {
  try {
    const r = await fetch(FEED, { headers: { "User-Agent": "DropWiseYYC/1.0 (hackathon project)" } });
    if (!r.ok) throw new Error(String(r.status));
    const xml = await r.text();
    const items = (xml.match(/<item>[\s\S]*?<\/item>/g) || [])
      .map((it) => ({ title: pick(it, "title"), link: pick(it, "link"), date: new Date(pick(it, "pubDate")).toLocaleDateString("en-CA", { timeZone: "America/Edmonton" }) }))
      .filter((i) => KEYWORDS.test(i.title))
      .slice(0, 5);
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(502).json({ items: [], error: "News feed unavailable" });
  }
}
