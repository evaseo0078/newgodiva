// GET /api/health — live water & health facts from public APIs listed by the hackathon. No keys needed.
//  • WHO Global Health Observatory (GHO OData API): % of Canadians using safely managed drinking water
//  • UN SDG API (Goal 6, indicator 6.1.1, series SH_H2O_SAFE): the same measure for the whole world
//  • Open Data Canada (CKAN Action API): recent Government of Canada datasets about drinking water & health
// Runs on the server so the browser isn't blocked by CORS, and caches for a day.

const TIMEOUT_MS = 7000;
const getJSON = async (url) => {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
};

// Latest national total (not urban/rural split) from a WHO GHO indicator.
async function who(indicator, country) {
  const url = `https://ghoapi.azureedge.net/api/${indicator}?$filter=SpatialDim eq '${country}'`;
  const rows = (await getJSON(url)).value || [];
  const total = rows.filter((r) => r.NumericValue != null && (!r.Dim1 || /TOTL|TOTAL|RESIDENCEAREATYPE_TOTL/i.test(r.Dim1)));
  const pick = (total.length ? total : rows.filter((r) => r.NumericValue != null)).sort((a, b) => b.TimeDim - a.TimeDim)[0];
  return pick ? { value: Math.round(pick.NumericValue * 10) / 10, year: pick.TimeDim } : null;
}

// Latest "all areas" value of an SDG series for an M49 area code (1 = World, 124 = Canada).
async function sdg(series, area) {
  const url = `https://unstats.un.org/SDGAPI/v1/sdg/Series/Data?seriesCode=${series}&areaCode=${area}&pageSize=500`;
  const rows = (await getJSON(url)).data || [];
  const all = rows.filter((r) => r.value != null && r.value !== "" && (!r.dimensions?.Location || r.dimensions.Location === "ALLAREA"));
  const pick = all.sort((a, b) => b.timePeriodStart - a.timePeriodStart)[0];
  return pick ? { value: Math.round(Number(pick.value) * 10) / 10, year: Math.round(pick.timePeriodStart) } : null;
}

// Government of Canada open datasets (CKAN package_search).
async function canadaDatasets() {
  const q = encodeURIComponent('"drinking water"');
  const url = `https://open.canada.ca/data/en/api/3/action/package_search?q=${q}&rows=6&sort=metadata_modified%20desc`;
  const res = (await getJSON(url)).result?.results || [];
  return res.map((p) => ({
    title: p.title_translated?.en || p.title,
    org: p.organization?.title?.split("|")[0]?.trim() || "Government of Canada",
    url: `https://open.canada.ca/data/en/dataset/${p.name}`,
    updated: (p.metadata_modified || "").slice(0, 10)
  })).filter((d) => d.title).slice(0, 5);
}

export default async function handler(req, res) {
  const jobs = {
    whoCanada: who("WSH_WATER_SAFELY_MANAGED", "CAN"),
    sdgWorld: sdg("SH_H2O_SAFE", 1),
    sdgCanada: sdg("SH_H2O_SAFE", 124),
    datasets: canadaDatasets()
  };
  const keys = Object.keys(jobs);
  const settled = await Promise.allSettled(Object.values(jobs));
  const out = { sources: {
    who: "WHO Global Health Observatory — WSH_WATER_SAFELY_MANAGED",
    sdg: "UN SDG API — Goal 6, indicator 6.1.1 (SH_H2O_SAFE)",
    canada: "Open Government Portal (open.canada.ca) — CKAN API"
  }, errors: [] };
  settled.forEach((s, i) => {
    if (s.status === "fulfilled" && s.value) out[keys[i]] = s.value;
    else out.errors.push(keys[i]);
  });
  if (out.errors.length === keys.length) return res.status(502).json({ error: "Health data sources unavailable", errors: out.errors });
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json(out);
}
