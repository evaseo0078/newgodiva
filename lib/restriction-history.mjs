import calendar from "../data/restriction-calendar.js";
import { appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTimeline, reconcileTimeline, latestAnnouncements } from "../data/restriction-timeline.js";
import { officialURL } from "./announcement-extraction.mjs";

const historyPath = join(tmpdir(), "dropwise-restriction-history-v1.jsonl");
const redisKey = "dropwise:restriction-history:v1";
async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command), signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("History storage unavailable");
  const value = await response.json();
  if (value.error) throw new Error("History storage unavailable");
  return value.result;
}
export function createHistoryStore({ remote = redis,
  append = record => appendFile(historyPath, JSON.stringify(record) + "\n"),
  read = () => readFile(historyPath, "utf8") } = {}) {
  const local = new Map();
  let lastStored = null, writeFailed = false;
  async function archive(snapshot) {
    const record = calendar.observation(snapshot);
    const events = (snapshot?.announcements || []).filter(event => event?.revision && event.id && officialURL(event.source))
      .map(event => ({ id: `announcement:${event.revision}:${event.accepted === false ? "rejected" : "accepted"}`, kind: "announcement-audit", event }))
      .filter(value => !local.has(value.id));
    const records = [...(record ? [record] : []), ...events];
    const signature = JSON.stringify([snapshot?.verifiedAt, snapshot?.stale, records.map(value => value.id)]);
    if (!records.length || signature === lastStored) return;
    const writes = await Promise.allSettled(records.map(async value => {
      local.set(value.id, value);
      await append(value).catch(() => {});
      await remote(["HSET", redisKey, value.id, JSON.stringify(value)]);
    }));
    writeFailed = writes.some(value => value.status === "rejected");
    if (!writeFailed) lastStored = signature;
  }
  async function get(snapshot) {
    await archive(snapshot);
    let stored = [], storage = "temporary", warning = null;
    try {
      const values = await remote(["HGETALL", redisKey]);
      if (values !== null) {
        storage = "durable";
        stored = values.filter((_, index) => index % 2 === 1).flatMap(value => { try { return [JSON.parse(value)]; } catch { return []; } });
      }
    } catch { warning = "Durable history storage is unavailable; showing available records."; }
    try {
      const lines = (await read()).split("\n");
      stored.push(...lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }));
    } catch {}
    const current = calendar.observation(snapshot);
    const all = [...stored, ...local.values()];
    const audit = [...new Map(all.filter(value => value?.kind === "announcement-audit" && officialURL(value.event?.source))
      .map(value => [value.id, value.event])).values()];
    const announcements = [...audit, ...(snapshot?.announcements || [])];
    const timeline = buildTimeline(announcements, { currentStatus: snapshot });
    if (writeFailed) warning = "Latest observations could not be saved to durable storage.";
    if (storage === "temporary" && !warning) warning = "History observations use temporary storage on this server; durable history storage is not configured.";
    return { records: reconcileTimeline(calendar.records, stored, [...local.values()], timeline.records, current ? [current] : []),
      audit, announcementCount: latestAnnouncements(announcements).length, timelineVersion: 2, extractionWarnings: [...(snapshot?.extractionWarnings || []), ...timeline.warnings.map(message => ({ message }))],
      storage, warning, stale: !!snapshot?.stale, checkedAt: new Date().toISOString(), coverage: "partial" };
  }
  return { archive, get };
}
const historyStore = createHistoryStore();
export const archiveObservation = historyStore.archive;
export const getRestrictionHistory = historyStore.get;
