import { officialURL, readHTML, readPDF, extractAnnouncements, discoveryLinks, rssLinks } from "./announcement-extraction.mjs";

export const NEWSROOM = "https://newsroom.calgary.ca/?h=1";
const MAX_BYTES = 2_000_000;
export async function fetchOfficial(source, fetcher = fetch, signal) {
  let url = officialURL(source);
  if (!url) throw new Error("Unofficial source URL");
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetcher(url, { headers: { "User-Agent": "DropWiseYYC/2.0", "Cache-Control": "no-cache" }, signal: signal || AbortSignal.timeout(8000), redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      url = officialURL(response.headers.get("location"), url);
      if (!url) throw new Error("Unofficial redirect");
      continue;
    }
    if (!response.ok) throw new Error("Official source unavailable");
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/(?:pdf|rss\+xml|atom\+xml|xml)|text\/xml/i.test(contentType)) throw new Error("Unsupported official source format");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Official document exceeds size limit");
    const chunks = [], reader = response.body?.getReader();
    let length = 0;
    if (!reader) throw new Error("Official source has no readable content");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) { await reader.cancel(); throw new Error("Official document exceeds size limit"); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    return { source: url, contentType, bytes, html: /html|xml/i.test(contentType) ? bytes.toString("utf8") : null };
  }
  throw new Error("Too many official redirects");
}

export async function collectAnnouncements({ sources, fetcher = fetch, now = new Date(), previous = [] } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 24000);
  const documents = [], failures = [], checked = new Set();
  const verifiedAt = now.toISOString();
  async function load(url, primary = false) {
    if (checked.has(url)) return;
    checked.add(url);
    try {
      const result = await fetchOfficial(url, fetcher, controller.signal);
      if (/xml/i.test(result.contentType) && !/html/i.test(result.contentType)) return { feed: rssLinks(result.html, result.source) };
      const document = /pdf/i.test(result.contentType) ? await readPDF(result.bytes, result.source, verifiedAt) : readHTML(result.html, result.source, verifiedAt);
      document.primary = primary;
      document.requestedSource = url;
      documents.push(document);
      return document;
    } catch (error) { failures.push({ source: url, error: error.name === "AbortError" ? "Source check timed out" : error.message }); }
  }
  try {
    const roots = await Promise.all([...sources.map(url => load(url, true)), load(NEWSROOM)]);
    const links = roots.filter(Boolean).flatMap(document => document.links ? discoveryLinks(document) : document.feed || []);
    const feeds = roots.filter(Boolean).flatMap(document => (document.links || []).filter(link => /rss|atom/i.test(link.type) || /alternate/i.test(link.rel) && /feed/i.test(link.url))).slice(0, 1);
    for (const feed of await Promise.all(feeds.map(link => load(link.url)))) if (feed?.feed) links.push(...feed.feed);
    links.push(...previous.filter(event => event.accepted !== false).slice(-4).map(event => ({ url: event.source, label: "Previously verified announcement" })));
    const candidates = [...new Map(links.map(link => [link.url, link])).values()]
      .filter(link => !checked.has(link.url))
      .sort((left, right) => Number(/declar|removal|lift/i.test(right.url + right.label)) - Number(/declar|removal|lift/i.test(left.url + left.label)))
      .slice(0, 10);
    await Promise.all(candidates.map(link => load(link.url)));
    const announcements = [], warnings = [];
    for (const document of documents) {
      if (document.requestedSource === NEWSROOM) continue;
      const extracted = extractAnnouncements(document);
      announcements.push(...extracted.announcements.map(event => ({ ...event, currentContext: document.primary })));
      warnings.push(...extracted.warnings.map(message => ({ source: document.source, message })));
    }
    return { documents, announcements, warnings, failures, checkedSources: [...checked] };
  } finally { clearTimeout(timer); }
}
