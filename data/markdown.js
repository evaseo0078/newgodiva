/* DropWise YYC — tiny, safe Markdown renderer for DropBot replies (no dependencies).
 * Security model: the WHOLE input is HTML-escaped first, so no tag or attribute from the model can survive.
 * Only a fixed set of tags is then produced by this code: p, br, strong, em, code, ul, ol, li, a.
 * Links are allowed only for http(s) and mailto; they open in a new tab with rel="noopener noreferrer nofollow".
 * Supported: paragraphs, line breaks, **bold**, __bold__, *italic*, _italic_, `code`, "-", "*", "•" and "1." lists,
 * "# heading" (shown bold), [text](https://…) links and bare https:// URLs.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// Inline formatting on ALREADY-ESCAPED text (no raw < > " ' can appear here).
function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  const links = [];
  const keep = (html) => { links.push(html); return `\u0001${links.length - 1}\u0001`; };
  const anchor = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
  // [label](url) — scheme allow-list; anything else (javascript:, data:, relative) stays as plain text
  s = s.replace(/\[([^\]\n]{1,200})\]\(((?:https?:\/\/|mailto:)[^\s()]{1,500})\)/gi, (_, label, href) => keep(anchor(href, label)));
  // bare URLs
  // (stops before an escaped quote, so `"https://x.ca"` doesn't swallow the closing &quot;)
  s = s.replace(/\bhttps?:\/\/(?:(?!&quot;|&#39;)[^\s<]){1,500}/gi, (m) => {
    const url = m.replace(/[.,;:!?)\]]+$/, ""), rest = m.slice(url.length);
    return keep(anchor(url, url)) + rest;
  });
  s = s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, "$1<em>$2</em>");
  return s
    .replace(/\u0001(\d+)\u0001/g, (_, i) => links[+i])
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

const BULLET = /^\s*[-*•]\s+(.*)$/, NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/, HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

/** Markdown → safe HTML string. */
export function renderMarkdown(source) {
  const lines = escapeHTML(String(source ?? "").replace(/\r\n?/g, "\n")).split("\n");
  const out = [];
  let para = [], list = null; // list = { tag: "ul"|"ol", items: [] }
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const line of lines) {
    const b = line.match(BULLET), n = !b && line.match(NUMBER), h = !b && !n && line.match(HEADING);
    if (b || n) {
      flushPara();
      const tag = b ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      (list ||= { tag, items: [] }).items.push((b || n)[1]);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else if (h) {
      flushPara(); flushList();
      out.push(`<p><strong>${inline(h[1])}</strong></p>`);
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += " " + line.trim(); // continuation of the previous list item
    } else {
      flushList(); para.push(line);
    }
  }
  flushPara(); flushList();
  return out.join("");
}

const markdown = { renderMarkdown, escapeHTML };
if (typeof window !== "undefined") window.DW_MARKDOWN = markdown;
export default markdown;
