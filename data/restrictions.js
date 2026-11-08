(function (root) {
  const source = "https://www.calgary.ca/water/drought/outdoor-water-restrictions.html";
  const scheduleSource = "https://www.calgary.ca/water/drought/lawn-watering-schedule.html";
  const fineSource = "https://www.calgary.ca/content/dam/www/uep/water/documents/water-documents/40M2006-water-utility-office-consolidation.pdf";
  const indoorAsks = ["Save water with shorter showers, full laundry and dishwasher loads, and repaired leaks. Indoor conservation advice is voluntary; stages regulate outdoor water use."];
  const stages = {};
  for (const stage of [0, 1, 2, 3, 4]) {
    const allowed = [], notAllowed = [], exceptions = [];
    const add = (permitted, text) => (permitted ? allowed : notAllowed).push(text);
    if (stage === 0) {
      allowed.push("No temporary outdoor restriction stage is in effect. The year-round lawn and landscape watering schedule still applies.", "Lawn watering (any method) and landscape sprinkler/irrigation: even addresses Tuesday, Thursday, Saturday; odd addresses Wednesday, Friday, Sunday; before 10 a.m. or after 7 p.m.", "Hand watering gardens with a watering can or spring-loaded nozzle, edible crops, and establishing new plants are allowed any day/time.", "Other outdoor uses follow normal bylaws; pools, hot tubs, fountains and exterior washing are permitted.");
      notAllowed.push("Lawn and landscape watering outside the normal schedule, unless an exception applies.");
    } else {
      if (stage <= 2) allowed.push(`Sprinklers/automatic-shutoff irrigation for homes and properties with fewer than 12 units: ${stage === 1 ? "2 hours" : "1 hour"} per week. Even addresses choose Tuesday OR Saturday; odd addresses choose Wednesday OR Sunday. Before 10 a.m. or after 7 p.m.`, `Properties with 12+ units and businesses: ${stage === 1 ? "two days weekly (even: Tuesday and Saturday; odd: Wednesday and Sunday)" : "one day weekly (even: Tuesday OR Saturday; odd: Wednesday OR Sunday)"}, before 10 a.m. or after 7 p.m.`, "Soaker hoses and drip irrigation follow the designated address days and watering times.");
      else notAllowed.push("Sprinkler and irrigation watering of lawns and landscapes.");
      add(stage < 4, "Hand watering non-edible gardens, trees and shrubs with a spring-loaded nozzle or hand-held container (lawns excluded)." );
      allowed.push(stage <= 2 ? "Edible crops: any watering method, any day/time." : "Edible crops: any day/time, only a spring-loaded hose nozzle or hand-held container.");
      add(stage < 4, `Establishing plants (sod within 21 days, seed within 45 days, trees/shrubs under 5 years): ${stage <= 2 ? "any method, any day/time" : "only a spring-loaded nozzle or hand-held container, any day/time; no irrigation"}.`);
      if (stage < 4) allowed.push(`Certified water managed sites: reduce watering by ${stage * 10}% (Tier One) or ${stage * 10 + 5}% (Tier Two).`);
      else notAllowed.push("Watering at certified water managed sites, including new sod, seed, trees and shrubs.");
      add(stage < 4, `Irrigation testing/auditing${stage === 3 ? ": only certified water managed sites or program applicants undergoing irrigation auditing" : " (any day/time)"}.`);
      add(stage < 4, "Washing exterior building surfaces/windows; graffiti removal with water.");
      add(stage <= 2, "Washing cars outdoors using water only (normal wastewater bylaws still apply).");
      notAllowed.push("Washing sidewalks, driveways and walkways, except where health and safety regulations require it.", "Filling fountains/decorative water features; bird baths and residential ponds are excluded.");
      add(stage <= 2, "Filling outdoor pools, hot tubs and wading pools.");
      add(stage <= 2, "Outdoor snow/ice making, including rink flooding or maintenance.");
      add(stage < 4, "City potable water for outdoor construction/renovation (special essential-work exceptions apply).");
      allowed.push("Indoor car washes, water for livestock, and watering plants grown for commercial sale or donation.", "Filling bird baths/residential ponds; indoor pools may operate.");
      exceptions.push("Health and safety requirements can exempt outdoor car and hard-surface washing; Stage 4 exterior building/window washing also has a health and safety exception.", "Businesses may use lawful non-potable sources. Access to City stormwater ponds is not permitted.", "Business exemption requests require City approval; submitting a request does not grant an exemption.");
      if (stage === 4) exceptions.push("Essential construction: watermain pressure testing and required backflow testing may continue; new-main chlorination/flushing is prohibited. Consult City construction guidance for service connections and hydrants.");
    }
    const fineAmount = [null, 400, 600, 1500, 3000][stage];
    stages[stage] = { stage, label: stage ? `Stage ${stage}` : "No Restrictions", source, scheduleSource, fineSource,
      fineAmount, fine: stage ? `Restriction violation fine: $${fineAmount.toLocaleString("en-CA")}${stage === 4 ? " (starting amount)" : ""}.` : "No stage-specific fine. Normal watering-schedule violations can carry a $200 fine.",
      summary: stage === 0 ? "Normal watering rules apply; no temporary restriction stage." : stage <= 2 ? "Scheduled landscape watering is permitted with limits; see address and property rules below." : stage === 3 ? "No landscape sprinklers. Limited hand watering and specified exceptions remain permitted." : "Outdoor City potable water use is prohibited except for the listed exceptions, including edible crops.",
      allowed, notAllowed, exceptions, indoorAsks };
  }
  const highlights = {
    0: { notAllowed: ["The normal lawn watering schedule still applies."], allowed: ["Even addresses: Tuesday, Thursday, Saturday. Odd: Wednesday, Friday, Sunday; before 10 a.m. or after 7 p.m.", "Hand watering gardens and watering edible crops are allowed any day."] },
    1: { notAllowed: ["Do not wash hard surfaces or fill decorative fountains, except for listed exceptions."], allowed: ["Small residential properties: up to 2 hours of sprinkler watering per week on an assigned day.", "Hand watering gardens and watering edible crops remain allowed. Different limits apply to larger sites."] },
    2: { notAllowed: ["Do not wash hard surfaces or fill decorative fountains, except for listed exceptions."], allowed: ["Small residential properties: up to 1 hour of sprinkler watering per week on an assigned day.", "Hand watering gardens and watering edible crops remain allowed. Larger sites have a one-day schedule."] },
    3: { notAllowed: ["No landscape sprinklers, outdoor car washing, pool filling or outdoor ice making, subject to listed exceptions."], allowed: ["Hand water non-edible gardens, trees and shrubs with a spring-loaded nozzle or container; lawns are excluded.", "Edible crops and establishing plants have limited hand-watering exceptions."] },
    4: { notAllowed: ["Do not water non-edible lawns, gardens, trees or shrubs.", "No outdoor car washing, pool filling or rink flooding, subject to listed exceptions."], allowed: ["Edible crops: use a spring-loaded hose nozzle or hand-held container.", "Indoor car washes, livestock water and plants grown for sale or donation remain allowed."] }
  };
  const categories = [
    "Lawns, gardens and irrigation",
    "Washing vehicles and surfaces",
    "Pools, fountains and outdoor ice",
    "Business, construction and essential uses"
  ];
  for (const rules of Object.values(stages)) {
    rules.highlights = highlights[rules.stage];
    rules.groups = categories.map(title => ({ title, allowed: [], notAllowed: [] }));
    for (const permission of ["allowed", "notAllowed"]) for (const text of rules[permission]) {
      const category = /commercial|livestock|construction|business|car washes/.test(text) ? 3 :
        /pool|fountain|pond|snow|ice making|rink|hot tub/.test(text) ? 2 : /wash|window|graffiti|sidewalk|driveway/i.test(text) ? 1 : 0;
      rules.groups[category][permission].push(text);
    }
  }
  const model = { stages, source, scheduleSource, reviewedOn: "2026-11-08" };
  if (typeof module !== "undefined") module.exports = model;
  else root.DW_RESTRICTIONS = model;
})(globalThis);
