import { getRestrictions } from "../lib/restrictions.mjs";
import { getRestrictionHistory } from "../lib/restriction-history.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  res.setHeader("Cache-Control", "no-store");
  const result = await getRestrictions();
  const history = await getRestrictionHistory(result);
  return res.status(result.stage === null ? 503 : 200).json({ ...result, history });
}
