import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, extname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { readHTML, extractAnnouncements } from "../lib/announcement-extraction.mjs";
import { buildTimeline } from "../data/restriction-timeline.js";
import calgaryTime from "../data/calgary-time.js";

const root = process.cwd();
const verifiedAt = "2027-05-05T18:00:00Z";
const source = "https://newsroom.calgary.ca/synthetic-water-test/";
const document = readHTML('<meta property="article:published_time" content="2027-05-01T12:00:00-06:00"><article>Stage 2 water restrictions begin May 3, 2027 at 6:00 am for approximately two weeks.</article>', source, verifiedAt);
const announcements = extractAnnouncements(document).announcements;
const scheduled = extractAnnouncements(readHTML('<article>Stage 3 water restrictions will begin June 28, 2027 for approximately three weeks.</article>', "https://newsroom.calgary.ca/synthetic-scheduled-water-test/", verifiedAt)).announcements;
const snapshot = { stage: 2, verifiedAt, stale: false, timezoneVersion: calgaryTime.version, announcements, sources: [source], effectiveFrom: announcements[0].effectiveAt, expectedDuration: announcements[0].duration.text };
snapshot.history = { records: buildTimeline([...announcements, ...scheduled], { currentStatus: snapshot }).records, storage: "temporary" };
const winterAnnouncements = extractAnnouncements(readHTML('<article>I hereby declare Stage 4 water restrictions commencing November 4, 2026 at 12:01 am ABT for approximately four weeks.</article>', source, "2026-11-08T18:00:00Z")).announcements;
const winter = { stage: 4, verifiedAt: "2026-11-08T18:00:00Z", stale: false, timezoneVersion: calgaryTime.version, sources: [source], announcements: winterAnnouncements, effectiveFrom: winterAnnouncements[0].effectiveAt, expectedDuration: winterAnnouncements[0].duration.text };
winter.history = { records: buildTimeline(winterAnnouncements, { currentStatus: winter }).records, storage: "temporary" };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + sep) || /(?:^|[\\/])\./.test(file.slice(root.length)) || ![".html", ".js", ".css", ".json", ".svg", ".png", ".ico"].includes(extname(file))) throw new Error("Unavailable asset");
    let content = await readFile(file);
    if (pathname === "/") content = Buffer.from(content.toString().replace(/<script\b[^>]*src="https:[^"]*"[^>]*><\/script>/g, "").replace(/<link\b[^>]*href="https:[^"]*"[^>]*>/g, ""));
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" })[extname(file)] || "application/octet-stream");
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(join(tmpdir(), "dropwise-calendar-browser-"));
const executable = process.env.CHROME_BIN || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "google-chrome");
const browser = spawn(executable, ["--headless", "--no-first-run", "--disable-extensions", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome startup timeout")), 10000);
    browser.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    browser.once("error", error => { clearTimeout(timer); reject(error); });
  });
  const targets = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const value = JSON.parse(event.data), waiter = pending.get(value.id);
    if (waiter) { pending.delete(value.id); value.error ? waiter.reject(new Error(JSON.stringify(value.error))) : waiter.resolve(value.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    const fixture=location.search.includes('winter')?${JSON.stringify(winter)}:${JSON.stringify(snapshot)};
    const NativeDate = Date;
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixture.verifiedAt])); } static now() { return NativeDate.parse(fixture.verifiedAt); } };
    localStorage.clear();
    localStorage.setItem('dw_guest','1');
    localStorage.setItem('dw_settings',JSON.stringify({household:3,perPerson:150,community:'Beltline'}));
    localStorage.setItem('dw_logs',JSON.stringify({'2027-05-03':[{litres:900,demo:true,by:'guest'}],'2027-05-04':[{litres:80,by:'guest'}],'2027-05-06':[{litres:600,by:'guest'}]}));
    localStorage.setItem('dw_readings',JSON.stringify([{date:'2027-05-04',ts:NativeDate.parse('2027-05-04T18:00Z'),litres:1000,by:'guest',value:1,unit:'m3'},{date:'2027-05-05',ts:NativeDate.parse('2027-05-05T18:00Z'),litres:1000,by:'guest',value:1,unit:'m3'},{date:'2027-05-08',ts:NativeDate.parse('2027-05-08T18:00Z'),litres:2000,by:'guest',value:2,unit:'m3'}]));
    window.smokeErrors=[];
    window.addEventListener('error',event=>smokeErrors.push(event.message));
    window.addEventListener('unhandledrejection',event=>smokeErrors.push(String(event.reason)));
    const nativeFetch=fetch.bind(window);
    window.restrictionFetches=0;
    window.fetch=async(url,options)=>String(url)==='/api/restrictions'?(restrictionFetches++,new Response(JSON.stringify(fixture),{headers:{'Content-Type':'application/json'}})):String(url)==='data/services.json'?nativeFetch(url,options):new Response('{}',{status:503});
  ` });
  for (const width of [1440, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const result = await send("Runtime.evaluate", { expression: "!!document.querySelector('#calendar .period-band.active')", returnByValue: true });
      if (result.result.value) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "The dynamically generated calendar did not load");
    const result = await send("Runtime.evaluate", { expression: `
      document.querySelector('[data-day="2027-05-06"]').click();
      const summary=document.querySelector('#calDetail').textContent;
      const current=document.querySelector('#currentRestrictionSummary').textContent;
      const defaultView=document.querySelector('#calendar').dataset.view;
      const legend=document.querySelector('#calendarLegend').textContent;
      const future=document.querySelector('[data-day="2027-05-06"] .period-band').dataset.certainty;
      const beyondEstimate=!document.querySelector('[data-day="2027-05-17"] .period-band');
      const timelineGlobal=!!window.DW_TIMELINE;
      const guideButtons=document.querySelectorAll('[data-guide-stage]').length;
      document.querySelector('[data-calendar-view="goals"]').click();
      const goalsOnly=!document.querySelector('.period-band')&&!document.querySelector('.construction-band')&&document.querySelector('#calendar').dataset.view==='goals';
      document.querySelector('[data-day="2027-05-05"]').click();
      const zeroRecorded=/Household goal met/.test(document.querySelector('#calDetail').textContent)&&/0 L/.test(document.querySelector('#calDetail').textContent);
      document.querySelector('[data-day="2027-05-06"]').click();
      const actualOver=/Over household goal/.test(document.querySelector('#calDetail').textContent);
      document.querySelector('[data-day="2027-05-07"]').click();
      const missingNeutral=/No household usage recorded/.test(document.querySelector('#calDetail').textContent)&&!document.querySelector('[data-day="2027-05-07"] .dot.over');
      document.querySelector('[data-day="2027-05-08"]').click();
      const gapNeutral=/Daily usage unavailable/.test(document.querySelector('#calDetail').textContent)&&!document.querySelector('[data-day="2027-05-08"] .dot.over');
      document.querySelector('[data-day="2027-05-03"]').click();
      const demoExcluded=/No household usage recorded/.test(document.querySelector('#calDetail').textContent);
      document.querySelector('[data-calendar-view="construction"]').click();
      const workOnly=!document.querySelector('.period-band')&&document.querySelector('#calendar').dataset.view==='construction';
      document.querySelector('[data-calendar-view="restrictions"]').click();
      document.querySelector('#calNext').click();
      const nextMonthUnknown=!document.querySelector('[data-day="2027-06-01"] .period-band');
      const scheduledStart=!!document.querySelector('[data-day="2027-06-28"] [data-certainty="scheduled"]');
      const scheduledPeriod=document.querySelector('[data-day="2027-06-29"] .period-band').dataset.period;
      document.querySelector('#calNext').click();
      const crossMonth=document.querySelector('[data-day="2027-07-01"] .period-band').dataset.period===scheduledPeriod;
      document.querySelector('#calPrev').click();
      document.querySelector('#calPrev').click();
      for(let offset=0;offset<6;offset++) document.querySelector('#calPrev').click();
      document.querySelector('[data-calendar-view="construction"]').click();
      const constructionBands=!!document.querySelector('.construction-band')&&!document.querySelector('.period-band');
      document.querySelector('[data-calendar-view="restrictions"]').click();
      for(let offset=0;offset<6;offset++) document.querySelector('#calNext').click();
      document.querySelector('[data-day="2027-05-06"]').click();
      const callsBeforeNavigation=restrictionFetches;
      let independentYears=true;
      for(const mode of ['restrictions','goals','construction']) {
        document.querySelector('[data-calendar-view="'+mode+'"]').click();
        for(let offset=0;offset<5;offset++) document.querySelector('#calPrev').click();
        document.querySelector('#calNext').click();
        independentYears=independentYears&&document.querySelector('#calendar').dataset.view===mode&&/January 2027/.test(document.querySelector('#calMonth').textContent)&&document.querySelectorAll('#calendar [role=gridcell]').length===42;
        for(let offset=0;offset<4;offset++) document.querySelector('#calNext').click();
      }
      const navigationLocal=restrictionFetches===callsBeforeNavigation;
      document.querySelector('[data-calendar-view="restrictions"]').click();
      document.querySelector('[data-day="2027-05-06"]').click();
      document.querySelector('#calTitle').scrollIntoView();
      ({cells:document.querySelectorAll('#calendar [role=gridcell]').length,overflow:document.querySelector('#calendar').getBoundingClientRect().right>innerWidth,errors:smokeErrors,summary,current,defaultView,legend,goalsOnly,workOnly,nextMonthUnknown,future,beyondEstimate,timelineGlobal,guideButtons,scheduledStart,crossMonth,constructionBands,zeroRecorded,actualOver,missingNeutral,gapNeutral,demoExcluded,independentYears,navigationLocal})
    `, returnByValue: true });
    const observed = result.result.value;
    assert.equal(observed.cells, 42);
    assert.equal(observed.overflow, false);
    assert.deepEqual(observed.errors, []);
    assert.equal(observed.defaultView, "restrictions");
    for (const property of ["goalsOnly", "workOnly", "nextMonthUnknown", "beyondEstimate", "timelineGlobal", "scheduledStart", "crossMonth", "constructionBands", "zeroRecorded", "actualOver", "missingNeutral", "gapNeutral", "demoExcluded", "independentYears", "navigationLocal"]) assert.equal(observed[property], true, property);
    assert.equal(observed.future, "estimated");
    assert.equal(observed.guideButtons, 5);
    assert.match(observed.current, /Stage 2/);
    assert.match(observed.current, /until the City announces a change/);
    assert.match(observed.current, /End date unknown/);
    assert.match(observed.summary, /not confirmed/);
    assert.doesNotMatch(observed.legend, /Officially scheduled|Confirmed No Restrictions|Goal met|Construction/);
    await new Promise(resolve => setTimeout(resolve, 500));
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const path = join(tmpdir(), `dropwise-calendar-${width}.png`);
    await writeFile(path, Buffer.from(screenshot.data, "base64"));
    console.log(`Browser passed at ${width}px: synthetic May Stage 2, bounded estimates, scheduled June/July Stage 3, unknown gaps, three filters, construction, year navigation, ESM startup, no JS errors or calendar overflow. Screenshot: ${path}`);
    await send("Runtime.evaluate", { expression: `document.querySelector('[data-calendar-view="goals"]').click();document.querySelector('[data-day="2027-05-07"]').click();document.querySelector('#calendarLegend').scrollIntoView();` });
    const goalsImage = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(join(tmpdir(), `dropwise-goals-${width}.png`), Buffer.from(goalsImage.data, "base64"));
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?scenario=winter` });
    let winterReady = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const loaded = await send("Runtime.evaluate", { expression: "document.querySelector('#currentRestrictionSummary')?.textContent || ''", returnByValue: true });
      if (/Stage 4/.test(loaded.result.value)) { winterReady = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(winterReady);
    const clock = await send("Runtime.evaluate", { expression: `({summary:document.querySelector('#currentRestrictionSummary').textContent,parsed:window.DW_TIMELINE.parseDate('November 4, 2026 at 12:01 am ABT').at,utcSeven:window.DW_CALGARY_TIME.format('2026-11-04T07:01:00Z',{hour:'numeric',minute:'2-digit',timeZoneName:'short'}),errors:smokeErrors})`, returnByValue: true });
    assert.match(clock.result.value.summary, /12:01.*a\.m\..*ABT/);
    assert.equal(clock.result.value.parsed, "2026-11-04T06:01:00.000Z");
    assert.match(clock.result.value.utcSeven, /1:01.*a\.m\..*ABT/);
    assert.deepEqual(clock.result.value.errors, []);
    await send("Runtime.evaluate", { expression: `document.querySelector('[data-calendar-view="construction"]').click();document.querySelector('[data-day="2026-11-14"]').click();document.querySelector('#calendarLegend').scrollIntoView();` });
    const constructionImage = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(join(tmpdir(), `dropwise-construction-${width}.png`), Buffer.from(constructionImage.data, "base64"));
    console.log(`Timezone and household audit passed at ${width}px: 00:01 ABT = 06:01 UTC; real zero/missing/demo/gapped records and independent year navigation verified.`);
  }
} finally {
  socket?.close();
  browser.kill();
  await new Promise(resolve => server.close(resolve));
}
