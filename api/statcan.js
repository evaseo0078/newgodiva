// GET /api/statcan — average daily RESIDENTIAL potable water use per person (litres) for Alberta and Canada,
// from Statistics Canada table 38-10-0271-01 via the Web Data Service (WDS). No key needed.
// Runs on the server because StatCan's WDS uses POST requests that browsers may block (CORS).

const WDS = "https://www150.statcan.gc.ca/t1/wds/rest";
const PID = 38100271;

const post = (method, body) => fetch(`${WDS}/${method}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
}).then((r) => (r.ok ? r.json() : null));

export default async function handler(req, res) {
  try {
    const meta = (await post("getCubeMetadata", [{ productId: PID }]))?.[0]?.object;
    if (!meta) throw new Error("metadata");
    const dims = [...meta.dimension].sort((a, b) => a.dimensionPositionId - b.dimensionPositionId);

    // Build a coordinate (10 positions) for a given geography, picking the "residential … per capita/person" member.
    const coordFor = (geoName) => {
      const ids = dims.map((d) => {
        const members = d.member || [];
        if (/geograph/i.test(d.dimensionNameEn)) return members.find((m) => m.memberNameEn === geoName)?.memberId;
        const res = members.find((m) => /residential/i.test(m.memberNameEn) && /per (capita|person)/i.test(m.memberNameEn));
        return res ? res.memberId : members[0]?.memberId;
      });
      if (ids.some((x) => x == null)) return null;
      while (ids.length < 10) ids.push(0);
      return ids.join(".");
    };

    const geos = ["Alberta", "Canada"];
    const coords = geos.map(coordFor);
    if (coords.some((c) => !c)) throw new Error("coordinate");
    const data = await post("getDataFromCubePidCoordAndLatestNPeriods",
      coords.map((coordinate) => ({ productId: PID, coordinate, latestN: 1 })));
    const out = {};
    geos.forEach((g, i) => {
      const p = data?.[i]?.object?.vectorDataPoint?.[0];
      if (p && p.value != null) out[g.toLowerCase()] = { litres: Math.round(p.value), year: String(p.refPer).slice(0, 4) };
    });
    if (!out.alberta) throw new Error("no value");

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ ...out, source: "Statistics Canada, Table 38-10-0271-01" });
  } catch (e) {
    return res.status(502).json({ error: "StatCan data unavailable (" + e.message + ")" });
  }
}
