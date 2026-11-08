import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { getRestrictions } from "../lib/restrictions.mjs";
import model from "../data/restrictions.js";
import { getRestrictionHistory } from "../lib/restriction-history.mjs";

const argument = process.argv[2];
if (argument && !/^(0|1|2|3|4|unknown|stale)$/.test(argument)) throw new Error("Use 0–4, stale, unknown, or omit for live verification");
const root = process.cwd();
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/api/restrictions") {
    const stage = argument === "unknown" ? null : argument === "stale" ? 2 : Number(argument);
    const result = argument ? { stage, rules: model.stages[stage] || null,
      verifiedAt: stage === null ? null : new Date(Date.now() - (argument === "stale" ? 86400000 : 0)).toISOString(),
      stale: argument === "stale" || stage === null, sources: ["https://www.calgary.ca/planning/water/bearspaw-feeder-main/water-restrictions.html"], fixture: true } : await getRestrictions();
    const history = await getRestrictionHistory(result);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ...result, history }));
    return;
  }
  const file = resolve(root, "." + decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + sep) || /(?:^|[\\/])\./.test(file.slice(root.length)) || ![".html", ".js", ".css", ".svg", ".png", ".jpg", ".webp", ".ico"].includes(extname(file)) || pathname.startsWith("/api/") || pathname.startsWith("/lib/") || pathname.startsWith("/scripts/")) {
    response.writeHead(404).end(); return;
  }
  try {
    const content = await readFile(file);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[extname(file)] || "application/octet-stream");
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
server.listen(3000, "127.0.0.1", () => console.log(`Restriction preview: http://127.0.0.1:3000 (${argument ? "TEST FIXTURE: " + argument : "live official verification"}). Other APIs require vercel dev.`));
