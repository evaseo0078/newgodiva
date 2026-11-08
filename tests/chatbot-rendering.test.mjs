import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../data/markdown.js";

const allowedTags = new Set(["p", "br", "strong", "em", "code", "ul", "ol", "li", "a"]);
function tagsIn(html) { return [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()); }

test("bold, italic, code, paragraphs and line breaks", () => {
  assert.equal(renderMarkdown("Hello **world** and *you*"), "<p>Hello <strong>world</strong> and <em>you</em></p>");
  assert.equal(renderMarkdown("__also bold__ _also em_ `x = 1`"), "<p><strong>also bold</strong> <em>also em</em> <code>x = 1</code></p>");
  assert.equal(renderMarkdown("line one\nline two\n\nnew paragraph"), "<p>line one<br>line two</p><p>new paragraph</p>");
  assert.equal(renderMarkdown("## Stage 4"), "<p><strong>Stage 4</strong></p>");
});

test("bullet and numbered lists, including * bullets Gemini uses", () => {
  assert.equal(renderMarkdown("Tips:\n* **Short** showers\n* Full loads\n- Fix leaks"),
    "<p>Tips:</p><ul><li><strong>Short</strong> showers</li><li>Full loads</li><li>Fix leaks</li></ul>");
  assert.equal(renderMarkdown("1. Go to Today\n2. Save reading"), "<ol><li>Go to Today</li><li>Save reading</li></ol>");
  assert.equal(renderMarkdown("* one\n  continues\n* two"), "<ul><li>one continues</li><li>two</li></ul>");
});

test("maths with * is not turned into italics", () => {
  assert.equal(renderMarkdown("5 * 150 L = 750 L"), "<p>5 * 150 L = 750 L</p>");
});

test("Korean, Chinese, Hindi and Arabic text render unchanged", () => {
  for (const t of ["**5인 가구**의 하루 권장량은 750L예요.", "您今天**还没有**保存水表读数。", "**Stage 4** जल प्रतिबंध लागू हैं।", "اضغط على **حفظ القراءة**"]) {
    const html = renderMarkdown(t);
    assert.match(html, /<strong>/); assert.equal(html.replace(/<[^>]+>/g, ""), t.replace(/\*\*/g, ""));
  }
});

test("links: http(s) and mailto only, opened safely", () => {
  assert.equal(renderMarkdown("See [City site](https://www.calgary.ca/savewater)."),
    '<p>See <a href="https://www.calgary.ca/savewater" target="_blank" rel="noopener noreferrer nofollow">City site</a>.</p>');
  assert.match(renderMarkdown("Visit https://calgary.ca/savewater."), /<a href="https:\/\/calgary\.ca\/savewater" [^>]+>https:\/\/calgary\.ca\/savewater<\/a>\.<\/p>$/);
  assert.match(renderMarkdown("[mail](mailto:help@example.com)"), /href="mailto:help@example.com"/);
  for (const bad of ["[x](javascript:alert(1))", "[x](JaVaScRiPt:alert(1))", "[x](data:text/html,<script>alert(1)</script>)", "[x](//evil.com)", "[x](/relative)"]) {
    const html = renderMarkdown(bad);
    assert.ok(!/<a\b/.test(html), bad); assert.ok(!/javascript:alert\(1\)"/.test(html));
  }
});

test("XSS: raw HTML, event handlers and attribute breakouts are escaped", () => {
  const attacks = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "**<b onmouseover=alert(1)>hi</b>**",
    '[click](https://ok.com" onmouseover="alert(1))',
    'https://ok.com"onmouseover="alert(1)',
    "* <iframe src=https://evil.com></iframe>",
    "`<script>`",
    "<a href='javascript:alert(1)'>x</a>",
    "&lt;script&gt; already escaped",
    "<svg/onload=alert(1)>"
  ];
  for (const a of attacks) {
    const html = renderMarkdown(a);
    for (const tag of tagsIn(html)) assert.ok(allowedTags.has(tag), `${a} → <${tag}>`);
    assert.ok(!/<(script|img|iframe|svg|b)\b/i.test(html), a);
    assert.ok(!/<(?!a\s)[a-z0-9]+\s[^>]*>/i.test(html), a); // only <a> may carry attributes (checked strictly below)
    for (const m of html.matchAll(/<a ([^>]*)>/g)) assert.match(m[1], /^href="(https?:|mailto:)[^"]*" target="_blank" rel="noopener noreferrer nofollow"$/, a);
  }
  assert.equal(renderMarkdown("&lt;b&gt;"), "<p>&amp;lt;b&amp;gt;</p>"); // shown literally, not decoded into a tag
});

test("empty and non-string input", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(null), "");
  assert.equal(renderMarkdown(42), "<p>42</p>");
});
