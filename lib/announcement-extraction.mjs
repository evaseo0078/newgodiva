import { createHash } from "node:crypto";
import calendar from "../data/restriction-calendar.js";
import calgaryTime from "../data/calgary-time.js";
import { parseDate, parseDuration } from "../data/restriction-timeline.js";

export function officialURL(value, base) {
  try {
    const url = new URL(value, base);
    url.hash = "";
    if ([...url.searchParams.keys()].every(key => key === "redirect") && url.searchParams.has("redirect")) url.search = "";
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["www.calgary.ca", "calgary.ca", "newsroom.calgary.ca"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
export function decodeText(value) {
  const entities = { amp: "&", nbsp: " ", quot: '"', apos: "'", rsquo: "'", lsquo: "'", ndash: "–", mdash: "—", lt: "<", gt: ">" };
  return value.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, entity) => {
    if (entity[0] !== "#") return entities[entity.toLowerCase()] || match;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
  }).replace(/[\u00a0\u200b]/g, " ");
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map(match => [match[1].toLowerCase(), decodeText(match[2] ?? match[3] ?? match[4])]));
}
export function plainText(html) {
  return decodeText(html.replace(/<(script|style|nav|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(?:p|div|h[1-6]|article|section|li|tr)>|<br\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t\r]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}
function publication(html, text) {
  const values = {};
  const apply = (key, value) => {
    if (typeof value !== "string") return;
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) && Number.isFinite(Date.parse(value))) {
      values[key] = new Date(value).toISOString(); values[key + "Date"] = calendar.dayKey(value);
    } else if (calendar.validDate(value)) values[key + "Date"] = value;
  };
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (/Article|NewsArticle|WebPage/i.test(String(value["@type"] || ""))) { apply("published", value.datePublished); apply("modified", value.dateModified); }
    if (value["@graph"]) visit(value["@graph"]);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch {}
  }
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = attributes(match[0]), key = attr.property || attr.name;
    if (["article:published_time", "datePublished", "date"].includes(key)) apply("published", attr.content);
    if (["article:modified_time", "dateModified"].includes(key)) apply("modified", attr.content);
  }
  const header = text.slice(0, 2200);
  const updated = header.match(/Updated:\s*([\s\S]{0,90})/i);
  if (updated && !values.modifiedDate) { const date = parseDate(updated[1]); if (date) { values.modifiedDate = date.date; values.modified = date.at; } }
  if (!values.publishedDate) {
    const date = header.match(/Calgary,?\s*(?:AB\s*[-–]\s*)?(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    const parsed = date ? parseDate(`${date[2]} ${date[1]}, ${date[3]}`) : html ? null : parseDate(header.slice(0, 100));
    if (parsed && !parsed.inferredYear) values.publishedDate = parsed.date;
  }
  return { publishedAt: values.published || null, publishedDate: values.publishedDate || null,
    sourceModifiedAt: values.modified || null, sourceModifiedDate: values.modifiedDate || null };
}
export function readHTML(html, source, verifiedAt) {
  const full = plainText(html);
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const heading = html.search(/<h1\b/i);
  const body = article || main || (heading >= 0 ? html.slice(heading).split(/<footer\b/i)[0] : html);
  const links = [...html.matchAll(/<(?:a|link)\b[^>]*>/gi)].flatMap(match => {
    const attr = attributes(match[0]), url = officialURL(attr.href, source);
    const label = plainText(html.slice(match.index + match[0].length, match.index + match[0].length + 250).split(/<\/a>/i)[0]);
    return url ? [{ url, label, rel: attr.rel || "", type: attr.type || "" }] : [];
  });
  return { source, verifiedAt, text: plainText(body), html, links, ...publication(html, full) };
}
export async function readPDF(bytes, source, verifiedAt) {
  const [{ getDocument }, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.mjs")]);
  globalThis.pdfjsWorker = worker;
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const document = await task.promise;
    if (document.numPages > 4) throw new Error("Declaration is unexpectedly long");
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str + (item.hasEOL ? "\n" : " ")).join(""));
      page.cleanup();
    }
    const text = pages.join("\n").replace(/[ \t]+/g, " ");
    if (text.trim().length < 40) throw new Error("Declaration has no extractable text");
    return { source, verifiedAt, text, links: [], pdf: true, ...publication("", text) };
  } finally { await task.destroy(); }
}

const stagePattern = /stage\s+([1-4])\s+(?:(?:mandatory|outdoor|city|potable)\s+)*water\s+(?:use\s+)?restrictions?/gi;
function signedDate(document, text) {
  const context = document.sourceModifiedDate || document.publishedDate;
  const parsed = parseDate(text, context);
  return parsed && (!parsed.inferredYear || context) ? parsed : null;
}
export function extractAnnouncements(document) {
  const text = document.text.replace(/\s+/g, " ");
  const announcements = [], warnings = [];
  const publishedDate = document.publishedDate;
  const create = facts => {
    const identity = `${document.source}|${facts.kind}|${facts.effectiveDate || facts.targetDate || publishedDate || "undated"}`;
    const id = createHash("sha256").update(identity).digest("hex");
    const value = { ...facts, id, source: document.source, publishedAt: document.publishedAt || null, publishedDate,
      sourceModifiedAt: document.sourceModifiedAt || null, sourceModifiedDate: document.sourceModifiedDate || null, verifiedAt: document.verifiedAt, timezoneVersion: calgaryTime.version, accepted: true };
    const { verifiedAt, evidence, ...stable } = value;
    value.revision = createHash("sha256").update(JSON.stringify(stable)).digest("hex");
    if (!announcements.some(event => event.revision === value.revision)) announcements.push(value);
  };
  const liftingClaims = [...text.matchAll(/(?:(?:all\s+)?(?:outdoor\s+)?water\s+restrictions\s+(?:are\s+|have\s+been\s+|will\s+be\s+)?(?:lifted|removed)|no\s+(?:outdoor\s+)?water\s+restrictions\s+(?:are\s+)?in\s+effect)/gi)];
  const lifted = liftingClaims.find(claim => !/\bstage\s+[1-4]\s+(?:(?:mandatory|outdoor|city|potable)\s+)*$/i.test(text.slice(Math.max(0, claim.index - 70), claim.index)));
  if (lifted) {
    const sentence = text.slice(Math.max(0, lifted.index - 100), lifted.index + 350);
    const following = text.slice(lifted.index, lifted.index + 350).split(/[.!?]\s+(?=[A-Z])/)[0];
    const preceding = text.slice(Math.max(0, lifted.index - 100), lifted.index).split(/[.!?]\s+(?=[A-Z])/).at(-1);
    const explicit = following.match(/(?:effective|as of|on|from|starting)\s+(.{1,90})/i) || preceding.match(/(?:effective|as of|starting)\s+([^.!?]{1,90})$/i);
    const date = (explicit ? signedDate(document, explicit[1]) : null) || (/immediately|today/i.test(sentence) && publishedDate ? { date: publishedDate, at: null } : null);
    if (date) create({ kind: "lifting", stage: 0, effectiveDate: date.date, effectiveAt: date.at || null, effectiveTime: date.time || null,
      scheduled: date.date > calendar.dayKey(document.verifiedAt), evidence: sentence.slice(0, 220) });
    else warnings.push("A lifting statement has no unambiguous effective date.");
  }
  const references = [...text.matchAll(stagePattern)];
  const boundaries = [...text.matchAll(/[.!?]\s+(?=[A-Z])/g)].map(match => match.index + 1);
  for (const reference of references) {
    const stage = Number(reference[1]);
    const start = Math.max(0, reference.index - 180, boundaries.filter(index => index < reference.index).at(-1) || 0);
    const end = Math.min(text.length, reference.index + 650, boundaries.find(index => index > reference.index) || text.length);
    const context = text.slice(start, end);
    const own = text.slice(reference.index, end);
    const formal = /I hereby declare/i.test(text.slice(Math.max(0, reference.index - 90), reference.index + 90));
    const removing = /(?:declare\s+an\s+end\s+to|restrictions?\s+removal)/i.test(context) || /water\s+restrictions\s+(?:are|have been|will be)\s+(?:lifted|removed)/i.test(own);
    const effective = own.match(/(?:commencing|effective|(?:take|takes|took)\s+effect|(?:will\s+)?(?:start(?:s|ed|ing)?|began|begin(?:s|ning)?)(?:\s+on)?)\s+(.{1,100})/i) ||
      context.match(/(?:beginning|starting|from)\s+(.{1,100})/i);
    if (/\b(?:not|never|could|might|would|may|proposed|tentative|cancelled|canceled)\b/i.test(own.slice(0, effective?.index ?? 180))) {
      warnings.push("An unconfirmed or negated proposal was excluded from the timeline."); continue;
    }
    let date = effective ? signedDate(document, effective[1]) : null;
    if (!date && /(?:in effect|moving|moved)\s+(?:as of\s+)?(?:this morning|today)|effective immediately|as of this morning/i.test(own) && publishedDate) date = { date: publishedDate, at: null };
    const duration = parseDuration(context);
    const expected = context.match(/(?:expected|estimated|anticipated)\s+(?:to\s+)?(?:(?:last|continue|remain)\s+)?(?:until|through|end(?:\s+on)?|between)\s+(.{1,120})/i);
    const expectedDate = expected ? signedDate(document, expected[1]) : null;
    const afterExpected = expectedDate ? expected[1].slice(expectedDate.index + expectedDate.text.length) : "";
    const endOfWindow = afterExpected.match(/^\s*(?:and|to|through|[-–])\s+(.+)/i);
    const latestExpected = endOfWindow ? signedDate(document, endOfWindow[1]) : expectedDate;
    const expectedWindow = expectedDate && latestExpected && latestExpected.date >= expectedDate.date ? { earliest: expectedDate.date, latest: latestExpected.date, derived: false, text: expected[0] } : null;
    if (expected && !expectedWindow) warnings.push("An announced end estimate has no unambiguous calendar boundary; its wording is retained.");
    const endDateMatch = own.match(/\b(?:will\s+)?(?:end|ends|lifted)\s+(?:on\s+)?(.{1,90})/i);
    const endPrefix = endDateMatch ? own.slice(Math.max(0, endDateMatch.index - 40), endDateMatch.index) : "";
    const confirmedEnd = endDateMatch && !/\b(?:expected|estimated|approximately|not|could|might)\b|\bmay\s+(?:be\s+)?$/i.test(endPrefix) && !/^(?:between|around|approximately|about|by)\b/i.test(endDateMatch[1]) ? signedDate(document, endDateMatch[1]) : null;
    const from = context.match(/(?:from|replacing)\s+stage\s+([1-4])\s+(?:to|with)\s+stage\s+([1-4])/i);
    const toStage = from ? Number(from[2]) : stage;
    const updating = /extend(?:ed|ing)?|revised|now expected|longer than|another\s+\w+\s+weeks?/i.test(context);
    if (!date && updating && (duration || expected)) {
      create({ kind: "estimate-update", stage: toStage, effectiveDate: null, effectiveAt: null, duration,
        expectedWindow,
        estimateText: expected?.[0] || duration?.text, totalDuration: /total|in all|from the start/i.test(context),
        estimateAnchor: /from today|another/i.test(context) ? publishedDate : null, evidence: context.slice(0, 220) });
      continue;
    }
    if (!date) continue;
    if (effective && date.inferredYear && /will|starting|beginning/i.test(context) && publishedDate && date.date < publishedDate) {
      warnings.push("A future date is missing a reliable year."); continue;
    }
    const scheduled = date.date > calendar.dayKey(document.verifiedAt) || /will be|will take|will begin|scheduled/i.test(own.slice(0, 180));
    create({ kind: removing ? "end" : from ? "change" : "declaration", stage: removing ? stage : toStage,
      fromStage: from ? Number(from[1]) : null, effectiveDate: date.date, effectiveAt: date.at || null,
      effectiveTime: date.time || null, precision: date.at ? "minute" : "date", scheduled: formal && date.date <= calendar.dayKey(document.verifiedAt) ? false : scheduled,
      declaration: formal || !!document.pdf, duration,
      expectedWindow,
      estimateText: expected?.[0] || duration?.text || null, confirmedEnd,
      evidence: (effective?.[0] || context).slice(0, 220) });
  }
  if (references.length && !announcements.length) warnings.push("The source mentions restrictions but supplies no reliably associated effective date.");
  const consolidated = new Map();
  for (const event of announcements) {
    const previous = consolidated.get(event.id);
    if (!previous || Number(!!event.effectiveAt) + Number(!!event.duration || !!event.expectedWindow) >= Number(!!previous.effectiveAt) + Number(!!previous.duration || !!previous.expectedWindow)) consolidated.set(event.id, event);
  }
  return { announcements: [...consolidated.values()], warnings };
}

export function discoveryLinks(document) {
  return document.links.filter(link => {
    const url = new URL(link.url);
    if (/\.pdf$/i.test(url.pathname)) return /declar|removal|lift/i.test(link.url + " " + link.label);
    return url.hostname === "newsroom.calgary.ca" && url.pathname !== "/" && /water|restriction|feeder|drought/i.test(url.pathname + " " + link.label);
  });
}
export function rssLinks(xml, base) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap(match => {
    const title = plainText(match[1].match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
    const link = officialURL(decodeText(match[1].match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || ""), base);
    return link && /water|restriction|feeder|drought/i.test(title) ? [{ url: link, label: title }] : [];
  });
}
