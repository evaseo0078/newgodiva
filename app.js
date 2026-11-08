/* DropWise YYC — front-end logic (no framework, no build step). */
(async () => {
  "use strict";
  const C = window.DW_CONFIG;
  const TZ = C.city.timezone;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtL = (n) => `${Math.round(n).toLocaleString("en-CA")} L`;
  const dateKey = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });
  const todayKey = () => dateKey();
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const niceDate = (k) => parseKey(k).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  const activity = (id) => C.activities.find((a) => a.id === id);

  /* ---------- storage (browser only) ---------- */
  // Signed-in user (from login.html). Each account's records are kept under its own key prefix.
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const CLOUD = window.DW_CLOUD || { enabled: false };
  let SESSION = readJSON("dw_session");
  // Online accounts (Supabase): the real session wins — this also catches the return from Google sign-in.
  if (CLOUD.enabled) {
    let s = null; try { s = await CLOUD.session(); } catch { /* offline */ }
    if (s) {
      const u = s.user, md = u.user_metadata || {};
      SESSION = { id: u.id, email: u.email, name: md.full_name || md.name || (u.email || "").split("@")[0] || "Neighbour", picture: md.avatar_url || md.picture, provider: "supabase" };
      try { localStorage.setItem("dw_session", JSON.stringify(SESSION)); localStorage.removeItem("dw_guest"); } catch {}
    } else if (SESSION?.provider === "supabase") { SESSION = null; try { localStorage.removeItem("dw_session"); } catch {} }
  }
  let isGuest = false; try { isGuest = localStorage.getItem("dw_guest") === "1"; } catch { isGuest = true; }
  if (!SESSION && !isGuest) { location.replace("login.html"); return; }
  const ME = SESSION?.id || "guest";
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); }));
  const NS = SESSION ? `dw_u_${SESSION.id}_` : "dw_";
  const GLOBAL_KEYS = new Set(["lang", "zoom"]); // device-wide preferences
  const keyFor = (k) => (GLOBAL_KEYS.has(k) ? "dw_" : NS) + k;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(keyFor(k)); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(keyFor(k), JSON.stringify(v)); } catch { /* storage unavailable: keep in memory */ } }
  };
  // Local records (used when you're not in an online household). Older formats are upgraded here.
  function localLogs() {
    const raw = store.get("logs", {}), out = {};
    for (const [k, list] of Object.entries(raw)) {
      const items = list.filter((e) => e.activity !== "meter-gap").map((e) => ({ id: e.id || newId(), by: e.by || ME, source: e.source || (e.minutes ? "timer" : "button"), ...e }));
      if (items.length) out[k] = items;
    }
    return out;
  }
  const localReadings = () => store.get("readings", []).map((r) => {
    const base = r.litres != null ? r : { ...r, value: r.m3, unit: "m3", litres: r.m3 * 1000 };
    return { id: base.id || newId(), by: base.by || ME, date: dateKey(new Date(base.ts)), ...base };
  });
  const S = {
    settings: store.get("settings", null),
    logs: localLogs(),                    // ESTIMATED: { "YYYY-MM-DD": [{id, activity, litres, minutes, source, ts, by}] }
    undo: store.get("undo", []).filter((u) => Array.isArray(u.steps)), // backup (Undo) — list of reversible steps, max 30
    redo: [],
    readings: localReadings(),            // MEASURED: [{id, ts, date, value, unit, litres, by}]
    hh: null,                             // online household (null = local mode)
    names: {},                            // user id → display name (who recorded)
    warnings: store.get("warnings", []),  // red mail
    read: store.get("read", []),
    showerStart: store.get("showerStart", null),
    news: [],
    ranking: null
  };
  const save = (k) => store.set(k, S[k]);

  /* ---------- language (i18n) ---------- */
  const I18N = window.DW_I18N || { en: {} };
  let lang = I18N[store.get("lang", "en")] ? store.get("lang", "en") : "en";
  const LOCALE = { en: "en-CA", ko: "ko-KR", zh: "zh-CN", hi: "hi-IN-u-nu-latn", ar: "ar-u-nu-latn" };
  // t("key", {n: 5}) → translated text with {n} filled in; falls back to English.
  function t(key, vars = {}) {
    let v = I18N[lang]?.[key] ?? I18N.en[key] ?? key;
    if (typeof v === "string") v = v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
    return v;
  }
  function applyStaticText() {
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.dataset.en == null) el.dataset.en = el.innerHTML;
      const v = lang === "en" ? null : I18N[lang]?.[el.dataset.i18n];
      el.innerHTML = v ?? el.dataset.en; // dictionary strings are written by the team (trusted)
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      if (el.dataset.enPh == null) el.dataset.enPh = el.placeholder;
      el.placeholder = (lang === "en" ? null : I18N[lang]?.[el.dataset.i18nPh]) ?? el.dataset.enPh;
    });
    const sel = document.getElementById("langSelect"); if (sel) sel.value = lang;
  }

  const perPersonGoal = () => S.settings?.perPerson || C.defaultPerPersonLitres;
  const residents = () => (S.hh ? S.hh.residents : S.settings?.household || 1);
  const budget = () => {
    if (S.hh) return S.hh.daily_goal_litres || S.hh.residents * perPersonGoal();
    return S.settings ? (S.settings.dailyGoal || S.settings.household * S.settings.perPerson) : 0;
  };
  const dayEntries = (k = todayKey()) => S.logs[k] || [];
  const estimatedTotal = (k = todayKey()) => dayEntries(k).reduce((s, e) => s + e.litres, 0);
  // Meter-based use for a day = last reading on that day − last reading before that day (litres).
  function meterUse(k = todayKey()) {
    const sorted = [...S.readings].sort((a, b) => a.ts - b.ts);
    const onDay = sorted.filter((r) => r.date === k), before = sorted.filter((r) => r.date < k);
    if (!onDay.length || !before.length) return null;
    const diff = onDay[onDay.length - 1].litres - before[before.length - 1].litres;
    return diff >= 0 ? diff : null;
  }
  // MEASURED (meter) and ESTIMATED (activities) are kept apart and never added together.
  // The day's total is the meter number when there is one; otherwise the activity estimate.
  const dayTotal = (k = todayKey()) => { const m = meterUse(k); return m != null ? m : estimatedTotal(k); };
  const isMeasured = (k = todayKey()) => meterUse(k) != null;
  const nameOf = (id) => (id === ME ? (SESSION?.name || t("user.guest")) : S.names[id] || t("hh.formerMember"));
  const firstName = (id) => (id === ME ? t("hh.you") : String(nameOf(id)).split(" ")[0]);

  /* ---------- settings ---------- */
  const dlg = $("#settingsDialog");
  // Community → quadrant lookup, filled from the City map (or the fallback list).
  S.commQuad = Object.fromEntries(C.fallbackCommunities.map((c) => [c.name.toUpperCase(), c.q]));
  const titleCase = (n) => n.toLowerCase().replace(/(^|[\s\/-])\w/g, (m) => m.toUpperCase());
  // The household's quadrant wins; otherwise it comes from the community chosen in Settings.
  const quadOf = (community) => S.hh?.quadrant || S.commQuad[String(community || "").toUpperCase()] || null;
  function fillCommunitySelect() {
    const sel = $("#setCommunity");
    const names = Object.keys(S.commQuad).sort().map(titleCase);
    sel.innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join("");
    if (S.settings) { const m = names.find((n) => n.toUpperCase() === S.settings.community.toUpperCase()); if (m) sel.value = m; }
  }
  async function loadCommunities() { await loadMapData(); fillCommunitySelect(); }
  function openSettings() {
    $("#setHousehold").closest("label").hidden = !!S.hh;
    $("#setHousehold").value = S.settings?.household ?? 3;
    $("#setPerPerson").value = S.settings?.perPerson ?? C.defaultPerPersonLitres;
    if (S.settings) $("#setCommunity").value = S.settings.community;
    $("#perPersonNote").textContent = C.perPersonNote;
    dlg.showModal();
  }
  $("#settingsForm").addEventListener("submit", () => {
    S.settings = {
      household: Math.max(1, +$("#setHousehold").value || 1),
      perPerson: Math.max(30, +$("#setPerPerson").value || C.defaultPerPersonLitres),
      community: $("#setCommunity").value || C.fallbackCommunities[0].name
    };
    save("settings");
    renderAll(); load311();
  });
  $("#settingsBtn").addEventListener("click", openSettings);

  /* ---------- text size: 100% → 115% → 130% → 145% ---------- */
  const ZOOM = [16, 18.4, 20.8, 23.2];
  let zoom = Math.min(ZOOM.length - 1, Math.max(0, store.get("zoom", 0)));
  function applyZoom() {
    document.documentElement.style.setProperty("--base", ZOOM[zoom] + "px");
    document.documentElement.classList.toggle("large-text", zoom > 0);
    $("#zoomLevel").textContent = Math.round((ZOOM[zoom] / 16) * 100) + "%";
    $("#zoomOut").disabled = zoom === 0; $("#zoomIn").disabled = zoom === ZOOM.length - 1;
    store.set("zoom", zoom);
    if (typeof lmap !== "undefined" && lmap) setTimeout(() => lmap.invalidateSize(), 50);
  }
  $("#zoomIn").addEventListener("click", () => { if (zoom < ZOOM.length - 1) { zoom++; applyZoom(); } });
  $("#zoomOut").addEventListener("click", () => { if (zoom > 0) { zoom--; applyZoom(); } });

  /* ---------- restriction status ---------- */
  const eventsOn = (k) => C.events.filter((e) => k >= e.start && k <= e.end);
  function renderStatus() {
    const pill = $("#statusPill");
    const r = eventsOn(todayKey()).find((e) => e.type === "restriction");
    pill.classList.toggle("active", !!r);
    if (!r) { pill.textContent = t("status.off"); return; }
    // "Stage 4" is underlined; hovering, focusing or tapping it shows what it means.
    pill.innerHTML = `<span aria-hidden="true">⚠️</span> <button type="button" class="stage-term" aria-describedby="stageTip" aria-expanded="false">${esc(t("status.term"))}</button>` +
      `<span class="pill-rest"> ${esc(t("status.rest"))}</span>` +
      `<span id="stageTip" class="stage-tip"><strong>${esc(t("stage.tipTitle"))}</strong>${esc(t("stage.tipBody"))}` +
      `<a href="#rulesTitle" class="stage-tip-link">${esc(t("stage.tipLink"))}</a></span>`;
    const btn = pill.querySelector(".stage-term");
    const setOpen = (open) => { pill.classList.toggle("tip-open", open); btn.setAttribute("aria-expanded", String(open)); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); pill.classList.remove("tip-suppress"); setOpen(!pill.classList.contains("tip-open")); });
    pill.querySelector(".stage-tip-link").addEventListener("click", (e) => { setOpen(false); e.currentTarget.blur(); pill.classList.add("tip-suppress"); });
    pill.addEventListener("mouseleave", () => pill.classList.remove("tip-suppress"));
    btn.addEventListener("focus", () => pill.classList.remove("tip-suppress"));
  }
  document.addEventListener("click", (e) => { const p = $("#statusPill"); if (p && !p.contains(e.target)) { p.classList.remove("tip-open"); p.querySelector(".stage-term")?.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { const p = $("#statusPill"); p?.classList.remove("tip-open"); p?.querySelector(".stage-term")?.setAttribute("aria-expanded", "false"); } });

  /* ---------- inbox ---------- */
  function messages() {
    const city = C.notices.filter((n) => n.date <= todayKey()).map((n) => ({ ...n, kind: "city" }));
    const warns = S.warnings.map((w) => ({ ...w, kind: "warn" }));
    const news = S.news.map((n) => ({ ...n, kind: "news" }));
    return [...warns, ...city, ...news].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  function renderInbox() {
    const msgs = messages();
    const unread = msgs.filter((m) => !S.read.includes(m.id) && m.kind !== "news");
    const badge = $("#inboxBadge");
    badge.hidden = !unread.length; badge.textContent = unread.length;
    $("#inboxList").innerHTML = msgs.map((m) => `
      <li class="mail ${m.kind} ${S.read.includes(m.id) || m.kind === "news" ? "" : "unread"}">
        <p class="mail-title">${m.kind === "warn" ? "🔴" : m.kind === "news" ? "📰" : "⚫"} ${esc(m.title)}</p>
        <p class="mail-meta">${m.kind === "warn" ? "DropWise usage warning" : m.kind === "news" ? "CBC Calgary" : "City of Calgary"}${m.date ? " · " + esc(niceDate(m.date)) : ""}</p>
        ${m.body ? `<p class="mail-body">${esc(m.body)}</p>` : ""}
        ${m.source ? `<p class="mail-body"><a href="${esc(m.source)}" target="_blank" rel="noopener">Source</a></p>` : ""}
      </li>`).join("") || "<li class='muted'>No alerts.</li>";

    // Top banner = most important unread (warnings first, then City notices)
    const top = unread.find((m) => m.kind === "warn") || unread.find((m) => m.kind === "city");
    const ta = $("#topAlert");
    if (!top) { ta.hidden = true; return; }
    ta.hidden = false; ta.className = "top-alert" + (top.kind === "warn" ? " warn" : "");
    ta.innerHTML = `<span aria-hidden="true" style="font-size:1.4rem">${top.kind === "warn" ? "🔴" : "✉️"}</span>
      <div><strong>${esc(top.title)}</strong><p>${esc(top.body || "")}</p></div>
      <button type="button" id="topAlertBtn">Mark as read</button>`;
    $("#topAlertBtn").onclick = () => { S.read.push(top.id); save("read"); renderInbox(); };
  }
  const inbox = $("#inbox");
  $("#inboxBtn").addEventListener("click", () => {
    inbox.hidden = false; $("#inboxClose").focus();
    messages().forEach((m) => { if (!S.read.includes(m.id)) S.read.push(m.id); });
    save("read");
  });
  $("#inboxClose").addEventListener("click", () => { inbox.hidden = true; renderInbox(); $("#inboxBtn").focus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !inbox.hidden) $("#inboxClose").click(); });

  async function loadNews() {
    try {
      const r = await fetch("/api/news");
      if (!r.ok) return;
      const data = await r.json();
      S.news = (data.items || []).map((n, i) => ({ id: "news" + i, title: n.title, date: n.date, source: n.link }));
      renderInbox();
    } catch { /* no server: skip news */ }
  }

  /* ---------- data layer: local (this browser) or online household (database) ---------- */
  const cloudOn = () => !!(S.hh && CLOUD.enabled);
  function persistLocal() { if (!cloudOn()) { store.set("logs", S.logs); store.set("readings", S.readings); } }
  const Data = {
    async addLog(e) {
      if (cloudOn()) await CLOUD.addLog(S.hh.id, e);
      const k = dateKey(new Date(e.ts));
      (S.logs[k] = S.logs[k] || []).push(e); S.logs[k].sort((a, b) => a.ts - b.ts); persistLocal();
    },
    async removeLog(e) {
      if (cloudOn()) await CLOUD.deleteLog(e.id);
      const k = dateKey(new Date(e.ts));
      S.logs[k] = (S.logs[k] || []).filter((x) => x.id !== e.id); if (!S.logs[k].length) delete S.logs[k]; persistLocal();
    },
    async addReading(r) {
      if (cloudOn()) await CLOUD.addReading(S.hh.id, r);
      S.readings.push({ ...r, date: dateKey(new Date(r.ts)) }); persistLocal();
    },
    async removeReading(r) {
      if (cloudOn()) await CLOUD.deleteReading(r.id);
      S.readings = S.readings.filter((x) => x.id !== r.id); persistLocal();
    }
  };
  const INVERSE = { addLog: "removeLog", removeLog: "addLog", addReading: "removeReading", removeReading: "addReading" };
  const canDelete = (row) => !cloudOn() || row.by === ME || S.hh?.myRole === "owner";
  function showDataError(err) {
    const code = err?.code || "network";
    $("#historyMsg").textContent = "⚠️ " + t("err." + code);
  }

  /* ---------- backup: undo / redo (each change is a list of reversible steps) ---------- */
  function persistUndo() { if (!cloudOn()) store.set("undo", S.undo); }
  async function act(label, steps) {
    try { for (const [op, row] of steps) await Data[op](row); }
    catch (err) { showDataError(err); renderAll(); return false; }
    S.undo.push({ label, steps }); if (S.undo.length > 30) S.undo.shift();
    S.redo = []; persistUndo();
    $("#historyMsg").textContent = `${t("hist.saved")}: ${label}`;
    renderAll(); return true;
  }
  async function undo() {
    const last = S.undo.pop(); if (!last) return;
    try { for (const [op, row] of [...last.steps].reverse()) await Data[INVERSE[op]](row); S.redo.push(last); $("#historyMsg").textContent = `${t("hist.undid")}: ${last.label}`; }
    catch (err) { S.undo.push(last); showDataError(err); }
    persistUndo(); renderAll();
  }
  async function redo() {
    const next = S.redo.pop(); if (!next) return;
    try { for (const [op, row] of next.steps) await Data[op](row); S.undo.push(next); $("#historyMsg").textContent = `${t("hist.redid")}: ${next.label}`; }
    catch (err) { S.redo.push(next); showDataError(err); }
    persistUndo(); renderAll();
  }
  function renderHistoryButtons() {
    const u = $("#undoBtn"), r = $("#redoBtn"), lu = S.undo[S.undo.length - 1], lr = S.redo[S.redo.length - 1];
    u.disabled = !lu; r.disabled = !lr;
    u.title = lu ? `Undo: ${lu.label}` : "Nothing to undo"; r.title = lr ? `Redo: ${lr.label}` : "Nothing to redo";
    $("#undoLabel").textContent = lu ? `: ${lu.label}` : "";
  }
  $("#undoBtn").addEventListener("click", undo);
  $("#redoBtn").addEventListener("click", redo);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  /* ---------- tank ---------- */
  const TANK_EMPTY_Y = 250, TANK_GOAL_Y = 80, TANK_TOP_Y = 22;
  function renderTank() {
    const used = dayTotal(), b = budget(), pct = b ? used / b : 0;
    let y = TANK_EMPTY_Y - Math.min(pct, 1) * (TANK_EMPTY_Y - TANK_GOAL_Y);
    if (pct > 1) y = Math.max(TANK_TOP_Y, TANK_GOAL_Y - (pct - 1) * 2 * (TANK_GOAL_Y - TANK_TOP_Y));
    $("#water").style.transform = `translateY(${y}px)`;
    const state = pct > 1 ? "over" : pct >= 0.8 ? "amber" : "safe"; // green → yellow → red
    const card = $(".tank-card");
    card.classList.remove("over", "amber", "safe"); card.classList.add(state);
    $("#overflow").toggleAttribute("hidden", pct <= 1);
    $("#tankValue").textContent = `${Math.round(pct * 100)}%`;
    $("#tankSub").textContent = t("tank.ofGoal");
    $("#usedBig").textContent = Math.round(used).toLocaleString("en-CA");
    const gi = $("#goalInput"); if (document.activeElement !== gi) gi.value = Math.round(b);
    $("#leftLine").textContent = used <= b ? t("tank.left", { n: fmtL(b - used) }) : t("tank.overBy", { n: fmtL(used - b) });
    const st = $("#tankStatus");
    st.className = "tank-status " + state;
    st.textContent = pct > 1 ? t("tank.over") : pct >= 0.8 ? t("tank.amber") : t("tank.safe");
    $("#tankLabel").textContent = `Water tank: ${fmtL(used)} used of ${fmtL(b)} daily goal`;
    // Measured vs estimated — the estimate is never added on top of the meter.
    const measured = meterUse(), est = estimatedTotal();
    const badge = $("#measureBadge");
    badge.className = "measure-badge " + (measured != null ? "measured" : "estimated");
    badge.textContent = measured != null ? t("total.measured") : t("total.estimated");
    $("#compareLine").textContent = measured != null
      ? t("total.compareMeasured", { e: fmtL(est) })
      : est > 0 ? t("total.compareEstimated") : "";
    const q = quadOf(S.settings?.community);
    $("#householdLine").textContent = S.hh
      ? t("hh.line", { name: S.hh.name, q: S.hh.quadrant, r: S.hh.residents, m: S.hh.members.length })
      : S.settings ? `${S.settings.household}-person household in ${S.settings.community}${q ? " (" + q + ")" : ""}` : "";
    const gi2 = $("#goalInput"); gi2.disabled = !!(S.hh && S.hh.myRole !== "owner");
    gi2.title = gi2.disabled ? t("hh.ownerOnly") : "";
    checkWarning(used, b);
  }
  $("#goalInput").addEventListener("change", (e) => {
    const v = Math.round(+e.target.value);
    if (!(v >= 20)) { e.target.value = Math.round(budget()); return; }
    if (S.hh) {
      if (S.hh.myRole !== "owner") return;
      CLOUD.updateHousehold(S.hh.id, { daily_goal_litres: v }).then((h) => { S.hh = { ...S.hh, ...h }; renderAll(); }).catch(showDataError);
      return;
    }
    S.settings.dailyGoal = v; save("settings"); renderAll();
  });
  function checkWarning(used, b) {
    const k = todayKey(), id = "warn-" + k;
    if (b && used > b && !S.warnings.some((w) => w.id === id)) {
      S.warnings.unshift({ id, date: k, title: "You've gone over today's water goal",
        body: `Your household has used ${fmtL(used)} today (goal ${fmtL(b)}). Keep showers to about 3 minutes and run only full loads.` });
      save("warnings");
    }
  }

  /* ---------- quick add + today's log (ESTIMATES, each linked to who recorded it) ---------- */
  function addLog(actId, litres, extra = {}, label) {
    const a = activity(actId);
    const entry = { id: newId(), activity: actId, litres, ts: Date.now(), by: ME, source: "button", ...extra };
    return act(label || `${t("act." + actId)} (+${Math.round(litres)} L)`, [["addLog", entry]]);
  }
  function renderQuickAdd() {
    $("#quickAdd").innerHTML = C.activities.filter((a) => !a.hidden).map((a) =>
      `<button type="button" class="glass-btn add" data-act="${a.id}" title="${esc(a.note)}"><span aria-hidden="true">${a.icon}</span> + ${esc(t("act." + a.id))} <small>(~${a.litres} L)</small></button>`).join("");
  }
  $("#quickAdd").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const a = activity(btn.dataset.act);
    addLog(a.id, a.litres, a.id === "shower" ? { minutes: Math.round(a.litres / a.perMinute) } : {});
  });
  function renderTodayLog() {
    const items = dayEntries();
    $("#logCount").textContent = items.length;
    $("#todayLog").innerHTML = items.map((e) => {
      const a = activity(e.activity) || { label: e.activity, icon: "💧" };
      const tm = new Date(e.ts).toLocaleTimeString(LOCALE[lang], { timeZone: TZ, hour: "numeric", minute: "2-digit" });
      const del = canDelete(e) ? `<button type="button" class="x" data-id="${e.id}" aria-label="${esc(t("log.remove"))}: ${esc(t("act." + e.activity))} ${tm}">✕</button>` : "<span></span>";
      return `<li><span>${a.icon} ${esc(t("act." + e.activity))}${e.minutes ? ` · ${e.minutes} min` : ""} <small class="by">· ${esc(firstName(e.by))}</small></span><span class="muted">${tm}</span><b>${fmtL(e.litres)}</b>${del}</li>`;
    }).reverse().join("") || `<li class='muted'>${esc(t("log.empty"))}</li>`;
  }
  $("#todayLog").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]"); if (!b) return;
    const item = dayEntries().find((x) => x.id === b.dataset.id); if (!item) return;
    act(`${t("log.removed")} ${t("act." + item.activity)}`, [["removeLog", item]]);
  });
  $("#resetDayBtn").addEventListener("click", () => {
    const k = todayKey();
    const steps = [...dayEntries(k).filter(canDelete).map((e) => ["removeLog", e]), ...S.readings.filter((r) => r.date === k && canDelete(r)).map((r) => ["removeReading", r])];
    if (!steps.length) return;
    if (cloudOn() && !confirm(t("hh.confirmClear"))) return;
    act(t("btn.clearToday"), steps).then(() => { S.warnings = S.warnings.filter((w) => w.id !== "warn-" + k); save("warnings"); renderInbox(); });
  });
  $("#demoBtn").addEventListener("click", () => {
    if (cloudOn()) return; // demo data never goes into a real household
    const n = S.settings?.household || 4, goal = budget() || n * 150, day = 864e5, steps = [];
    for (const r of [...S.readings]) steps.push(["removeReading", r]);
    let m3 = 1234.0;
    for (let i = 7; i >= 0; i--) {
      const d = new Date(Date.now() - i * day - (i === 0 ? 3600e3 : 0));
      if (i < 7) m3 += (goal * (0.82 + ((i * 37) % 28) / 100)) / 1000;
      steps.push(["addReading", { id: newId(), ts: d.getTime(), value: +m3.toFixed(3), unit: "m3", litres: +m3.toFixed(3) * 1000, by: ME, demo: true }]);
    }
    const add = (id, times) => Array.from({ length: times }, (_, i) => ["addLog", { id: newId(), activity: id, litres: activity(id).litres, ts: Date.now() - (times - i) * 60e3, by: ME, source: "button", demo: true, ...(id === "shower" ? { minutes: 3 } : {}) }]);
    steps.push(...add("shower", Math.max(1, n - 1)), ...add("toilet", n * 3), ...add("laundry", 1), ...add("dishwasher", 1), ...add("other", 1));
    act(t("btn.demo"), steps);
  });

  /* ---------- water meter: one decimal number + unit (m³ or ft³) + time read ---------- */
  // Every reading is stored with its unit and time, and converted to litres so any two readings can be compared.
  const L_PER = { m3: 1000, ft3: 28.316846592 };
  const UNIT_LABEL = { m3: "m³", ft3: "ft³" };
  const toLitres = (value, unit) => value * (L_PER[unit] || 1000);
  const fmtReading = (r) => `${Number(r.value).toLocaleString("en-CA", { maximumFractionDigits: 4 })} ${UNIT_LABEL[r.unit] || r.unit}`;
  const localInputValue = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const sortedReadings = () => [...S.readings].sort((a, b) => a.ts - b.ts);
  $("#meterUnit").value = store.get("meterUnit", "m3");
  $("#meterTime").value = localInputValue();
  function updateLitresPreview() {
    const v = parseFloat($("#meterValue").value), unit = $("#meterUnit").value, el = $("#meterLitresPreview");
    if (!(v >= 0)) { el.textContent = "—"; $("#meterDiffPreview").textContent = ""; return; }
    const L = toLitres(v, unit), prev = sortedReadings().filter((r) => r.ts < meterTimeTs()).pop();
    el.textContent = Math.round(L).toLocaleString("en-CA") + " L";
    $("#meterDiffPreview").textContent = prev ? t("meter.sincePrev", { n: fmtL(L - prev.litres) }) : "";
  }
  const meterTimeTs = () => { const v = $("#meterTime").value; const d = v ? new Date(v) : new Date(); return isNaN(d) ? Date.now() : d.getTime(); };
  ["input", "change"].forEach((ev) => {
    $("#meterValue").addEventListener(ev, updateLitresPreview);
    $("#meterTime").addEventListener(ev, updateLitresPreview);
  });
  $("#meterUnit").addEventListener("change", () => { store.set("meterUnit", $("#meterUnit").value); updateLitresPreview(); });
  $("#meterValue").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#reconcileBtn").click(); } });

  function renderMeterInfo() {
    const rs = sortedReadings(), last = rs[rs.length - 1], info = $("#meterInfo");
    renderReadings();
    if (!last) { info.textContent = t("meter.hint"); return; }
    const used = meterUse();
    const when = new Date(last.ts).toLocaleString(LOCALE[lang], { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" });
    info.innerHTML = `${esc(t("meter.last"))} <strong>${esc(fmtReading(last))}</strong> (${esc(when)}).` +
      (used != null ? ` ${esc(t("meter.today"))} <strong>${fmtL(used)}</strong>.` : ` ${esc(t("meter.tomorrow"))}`);
  }
  function renderReadings() {
    const rs = sortedReadings(), body = $("#readingsBody"); if (!body) return;
    const rows = rs.map((r, i) => {
      const prev = rs[i - 1], diff = prev ? r.litres - prev.litres : null, hrs = prev ? (r.ts - prev.ts) / 3600e3 : null;
      const when = new Date(r.ts).toLocaleString(LOCALE[lang], { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const d = diff == null ? "—" : `${diff >= 0 ? "+" : ""}${fmtL(diff)}${hrs ? ` <small class="muted">/ ${hrs < 48 ? Math.round(hrs) + " h" : Math.round(hrs / 24) + " d"}</small>` : ""}`;
      return `<tr class="${diff != null && diff < 0 ? "neg" : ""}"><td>${esc(when)}</td><td>${esc(fmtReading(r))}</td><td>${d}</td><td>${esc(firstName(r.by))}</td></tr>`;
    }).reverse().slice(0, 6);
    body.innerHTML = rows.join("") || `<tr><td colspan="4" class="muted">${esc(t("meter.noReadings"))}</td></tr>`;
  }

  // 1) Photo → AI reads the number (and unit, if printed) → fills the input. The photo is shrunk in the browser, sent once, then discarded.
  $("#scanBtn").addEventListener("click", () => $("#meterPhoto").click());
  $("#meterPhoto").addEventListener("change", async (e) => {
    const file = e.target.files?.[0], msg = $("#scanMsg");
    e.target.value = ""; // forget the file immediately
    if (!file) return;
    msg.className = "scan-msg"; msg.textContent = t("scan.reading");
    let dataUrl = null;
    try {
      dataUrl = await shrinkImage(file, 1280);
      const r = await fetch("/api/meter-read", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl.split(",")[1], mediaType: "image/jpeg" }) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "unavailable");
      if (out.reading == null) {
        msg.className = "scan-msg warn"; msg.textContent = t("scan.unclear");
      } else {
        $("#meterValue").value = out.reading;
        if (L_PER[out.unit]) { $("#meterUnit").value = out.unit; store.set("meterUnit", out.unit); }
        $("#meterTime").value = localInputValue();
        msg.className = "scan-msg " + (out.confidence === "high" ? "ok" : "warn");
        msg.textContent = t(out.confidence === "high" ? "scan.ok" : "scan.check", { n: `${out.reading} ${UNIT_LABEL[out.unit] || ""}`.trim() });
        updateLitresPreview();
      }
    } catch (err) {
      msg.className = "scan-msg warn"; msg.textContent = t("scan.unavailable");
    } finally { dataUrl = null; $("#meterValue").focus(); }
  });
  function shrinkImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const out = c.toDataURL("image/jpeg", 0.85); c.width = c.height = 0; resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }

  // 2) Save the reading (value + unit + time) and reconcile today's log with the meter; any gap goes to "Extra".
  $("#reconcileBtn").addEventListener("click", () => {
    const v = parseFloat(String($("#meterValue").value).replace(",", ".")), unit = $("#meterUnit").value, info = $("#meterInfo");
    if (!(v >= 0)) { info.textContent = t("meter.empty"); $("#meterValue").focus(); return; }
    const ts = Math.min(meterTimeTs(), Date.now() + 5 * 60e3), litres = toLitres(v, unit);
    const rs = sortedReadings(), prev = rs.filter((r) => r.ts < ts).pop(), next = rs.find((r) => r.ts > ts);
    if (prev && litres < prev.litres) { info.textContent = t("meter.lower", { r: fmtReading(prev) }); return; }
    if (next && litres > next.litres) { info.textContent = t("meter.higher", { r: fmtReading(next) }); return; }
    if (prev && litres - prev.litres > 5000 && !confirm(t("meter.bigJump", { n: fmtL(litres - prev.litres) }))) return;
    const row = { id: newId(), ts, value: v, unit, litres, by: ME };
    act(`${t("meter.title")} ${v} ${UNIT_LABEL[unit]}`, [["addReading", row]]).then((ok) => {
      if (!ok) return;
      const measured = meterUse(), est = estimatedTotal();
      $("#meterInfo").textContent = measured != null
        ? t("meter.compare", { m: fmtL(measured), e: fmtL(est) })
        : prev ? t("meter.savedDiff", { n: fmtL(litres - prev.litres) }) : t("meter.savedFirst");
      maybeShareUsage();
    });
    $("#meterValue").value = ""; $("#meterTime").value = localInputValue(); $("#scanMsg").textContent = ""; updateLitresPreview();
  });

  /* ---------- donut ---------- */
  // Breakdown of the ESTIMATES by category. If the meter measured more, the rest shows as "Not itemized" (display only).
  const UNITEMIZED = { id: "unitemized", color: "#b0bec5" };
  function categoryTotals(k = todayKey()) {
    const tt = Object.fromEntries(C.categories.map((c) => [c.id, 0]));
    dayEntries(k).forEach((e) => { const a = activity(e.activity); if (a) tt[a.category] += e.litres; });
    const m = meterUse(k), est = Object.values(tt).reduce((a, b) => a + b, 0);
    tt.unitemized = m != null && m > est ? m - est : 0;
    return tt;
  }
  function renderDonut() {
    const tt = categoryTotals(), total = Object.values(tt).reduce((a, b) => a + b, 0);
    const svg = $("#donut"); const R = 70, cx = 100, cy = 100, circ = 2 * Math.PI * R;
    let off = 0, arcs = "";
    if (!total) arcs = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="34"/>`;
    [...C.categories, UNITEMIZED].forEach((c) => {
      if (!total || !tt[c.id]) return;
      const len = (tt[c.id] / total) * circ;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${c.color}" stroke-width="34"
        stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"/>`;
      off += len;
    });
    svg.innerHTML = `<title id="donutLabel">Water use by category</title>` + arcs;
    $("#donutLegend").innerHTML = [...C.categories, ...(tt.unitemized ? [UNITEMIZED] : [])].map((c) => `<li><i style="background:${c.color}"></i>${t("cat." + c.id)}
      <b>${total ? Math.round((tt[c.id] / total) * 100) : 0}%</b></li>`).join("");
    const ins = $("#insight");
    if (!total) { ins.textContent = t("tip.none"); return; }
    const top = C.categories.reduce((a, c) => (tt[c.id] > tt[a.id] ? c : a));
    ins.textContent = t("tip." + top.id, { p: Math.round((tt.washroom / total) * 100) });
  }

  /* ---------- calendar ---------- */
  let calCursor = (() => { const d = parseKey(todayKey()); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let selectedDay = todayKey();
  function renderCalendar() {
    const y = calCursor.getFullYear(), m = calCursor.getMonth();
    $("#calMonth").textContent = calCursor.toLocaleDateString(LOCALE[lang], { month: "long", year: "numeric" });
    const start = new Date(y, m, 1 - new Date(y, m, 1).getDay());
    let html = [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2026, 10, 1 + i).toLocaleDateString(LOCALE[lang], { weekday: "short" })).map((d) => `<div class="cal-dow" role="columnheader">${d}</div>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = keyOf(d);
      const evs = eventsOn(k);
      const used = dayTotal(k), b = budget();
      const dot = used && b ? `<i class="dot ${used > b ? "over" : "ok"}" title="${used > b ? "Over goal" : "Goal met"}"></i>` : "";
      const evHtml = evs.map((e) => {
        const first = k === e.start || d.getDay() === 0;
        return `<span class="ev ${e.type} ${first ? "" : "cont"}">${first ? esc(e.title) : ""}</span>`;
      }).join("");
      const label = `${niceDate(k)}${evs.length ? ": " + evs.map((e) => e.title).join(", ") : ""}`;
      html += `<button type="button" role="gridcell" class="cal-day ${d.getMonth() !== m ? "other" : ""} ${k === todayKey() ? "today" : ""} ${k === selectedDay ? "selected" : ""}"
        data-day="${k}" aria-label="${esc(label)}"><span class="num">${d.getDate()}</span>${dot}${evHtml}</button>`;
    }
    $("#calendar").innerHTML = html;
    renderCalDetail();
  }
  function renderCalDetail() {
    const evs = eventsOn(selectedDay), used = dayTotal(selectedDay), b = budget();
    const meaning = { restriction: "Outdoor water use is restricted. Please cut back indoors too — shorter showers, full loads only.",
      construction: "Construction nearby. Expect road closures; your tap water should keep flowing.",
      info: "Good news — no restrictions expected for this step." };
    $("#calDetail").innerHTML = `<h4>${esc(niceDate(selectedDay))}</h4>
      ${evs.length ? `<ul>${evs.map((e) => `<li><strong>${esc(e.title)}${e.approx ? " (approx. dates)" : ""}</strong> — ${esc(e.detail)}
        <br><em>What this means for you:</em> ${meaning[e.type]} <a href="${esc(e.source)}" target="_blank" rel="noopener">Source</a></li>`).join("")}</ul>`
        : "<p class='muted'>No City events on this day.</p>"}
      ${used ? `<p>${esc(t(isMeasured(selectedDay) ? "cal.usedMeasured" : "cal.usedEstimated", { n: fmtL(used), g: fmtL(b) }))}</p>` : ""}
      ${(() => { // who recorded what that day
        const by = {};
        dayEntries(selectedDay).forEach((e) => { by[e.by] = (by[e.by] || 0) + 1; });
        S.readings.filter((r) => r.date === selectedDay).forEach((r) => { by[r.by] = (by[r.by] || 0) + 1; });
        const list = Object.entries(by).map(([id, n]) => `${esc(firstName(id))} (${n})`).join(", ");
        return list ? `<p class="muted">${esc(t("cal.recordedBy"))} ${list}</p>` : "";
      })()}`;
  }
  $("#calendar").addEventListener("click", (e) => { const b = e.target.closest("[data-day]"); if (!b) return; selectedDay = b.dataset.day; renderCalendar(); });
  // Month navigation: buttons, swipe/drag, trackpad, keyboard (PageUp/PageDown) — unlimited in both directions.
  const calEl = $("#calendar");
  function moveMonth(dir) {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + dir, 1);
    renderCalendar();
    calEl.classList.remove("slide-next", "slide-prev"); void calEl.offsetWidth;
    calEl.classList.add(dir > 0 ? "slide-next" : "slide-prev");
  }
  $("#calPrev").addEventListener("click", () => moveMonth(-1));
  $("#calNext").addEventListener("click", () => moveMonth(1));
  $("#calToday").addEventListener("click", () => {
    const t = parseKey(todayKey());
    const diff = (t.getFullYear() - calCursor.getFullYear()) * 12 + t.getMonth() - calCursor.getMonth();
    selectedDay = todayKey();
    if (diff) moveMonth(diff); else renderCalendar();
  });
  let drag = null, justSwiped = false;
  calEl.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; });
  calEl.addEventListener("pointermove", (e) => { if (drag && Math.abs(e.clientX - drag.x) > 10) calEl.classList.add("dragging"); });
  const endDrag = (e) => {
    calEl.classList.remove("dragging");
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { justSwiped = true; moveMonth(dx < 0 ? 1 : -1); setTimeout(() => (justSwiped = false), 50); }
  };
  calEl.addEventListener("pointerup", endDrag);
  calEl.addEventListener("pointercancel", () => { drag = null; calEl.classList.remove("dragging"); });
  calEl.addEventListener("click", (e) => { if (justSwiped) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  let wheelLock = false;
  calEl.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaX) < 30 || Math.abs(e.deltaX) < Math.abs(e.deltaY) || wheelLock) return;
    e.preventDefault(); wheelLock = true; moveMonth(e.deltaX > 0 ? 1 : -1); setTimeout(() => (wheelLock = false), 600);
  }, { passive: false });
  calEl.closest(".card").addEventListener("keydown", (e) => {
    if (e.key === "PageDown") { e.preventDefault(); moveMonth(1); }
    if (e.key === "PageUp") { e.preventDefault(); moveMonth(-1); }
  });

  /* ---------- shower challenge ---------- */
  const GOAL_SEC = C.showerGoalSeconds || 180, RING = 326.7, GOAL_TXT = `${Math.round(GOAL_SEC / 60)} minutes`;
  let tick = null;
  function updateTimer() {
    const sec = S.showerStart ? (Date.now() - S.showerStart) / 1000 : 0;
    $("#timerDisplay").textContent = mmss(sec);
    $("#timerLitres").textContent = fmtL((sec / 60) * activity("shower").perMinute);
    const ring = $("#ringFg");
    ring.style.strokeDashoffset = RING * (1 - Math.min(sec / GOAL_SEC, 1));
    ring.classList.toggle("over", sec > GOAL_SEC);
    if (S.showerStart && Math.floor(sec) === GOAL_SEC) $("#showerMsg").textContent = `⏰ ${GOAL_TXT}! Time to rinse and finish.`;
  }
  function setShowerUi() {
    const btn = $("#showerBtn"), on = !!S.showerStart;
    btn.textContent = on ? t("shower.stop") : t("shower.start");
    btn.classList.toggle("stop", on);
    clearInterval(tick); if (on) tick = setInterval(updateTimer, 500);
    updateTimer();
  }
  $("#showerBtn").addEventListener("click", () => {
    if (!S.showerStart) {
      S.showerStart = Date.now(); store.set("showerStart", S.showerStart);
      $("#showerMsg").textContent = "Timer running — enjoy your shower!";
    } else {
      const sec = Math.round((Date.now() - S.showerStart) / 1000);
      S.showerStart = null; store.set("showerStart", null);
      if (sec >= 10) {
        const litres = (sec / 60) * activity("shower").perMinute;
        addLog("shower", litres, { minutes: +(sec / 60).toFixed(1), source: "timer" }, `${t("act.shower").split(" (")[0]} ${mmss(sec)} (+${Math.round(litres)} L)`);
        $("#showerMsg").textContent = sec <= GOAL_SEC ? `🎉 ${mmss(sec)} — under ${GOAL_TXT}! Saved water logged.` : `${mmss(sec)} logged. The City asks for about ${GOAL_TXT} — try again tomorrow!`;
      } else $("#showerMsg").textContent = "Too short to log.";
    }
    setShowerUi(); renderShowers();
  });
  // Showers come from the activity log (timer or the 3-minute button) and keep who took them.
  const allShowers = () => Object.values(S.logs).flat().filter((e) => e.activity === "shower")
    .map((e) => ({ ...e, seconds: Math.round((e.minutes || e.litres / activity("shower").perMinute) * 60) })).sort((a, b) => a.ts - b.ts);
  const myShowers = () => allShowers().filter((s) => s.by === ME);
  function weekAvg(daysAgoStart, daysAgoEnd) {
    const now = Date.now(), day = 864e5;
    const list = myShowers().filter((x) => now - x.ts >= daysAgoStart * day && now - x.ts < daysAgoEnd * day);
    return list.length ? list.reduce((a, b) => a + b.seconds, 0) / list.length : null;
  }
  function renderShowers() {
    const recent = allShowers().slice(-8).reverse();
    const max = Math.max(GOAL_SEC * 2, ...recent.map((s) => s.seconds));
    $("#showerHistory").innerHTML = recent.length ? recent.map((s) => `<li class="${s.by === ME ? "mine" : ""}"><span>${esc(niceDate(dateKey(new Date(s.ts))))}<small class="by">${esc(firstName(s.by))}</small></span>
      <span class="hbar ${s.seconds > GOAL_SEC ? "over" : ""}" style="width:${(s.seconds / max) * 100}%"></span>
      <span class="t">${mmss(s.seconds)}</span></li>`).join("") : `<li class='muted'>${esc(t("shower.none"))}</li>`;

    const thisWk = weekAvg(0, 7), lastWk = weekAvg(7, 14);
    const imp = thisWk && lastWk ? Math.round(((lastWk - thisWk) / lastWk) * 100) : null;
    const streak = (() => { let n = 0; for (const x of [...myShowers()].reverse()) { if (x.seconds <= GOAL_SEC) n++; else break; } return n; })();
    $("#myStats").innerHTML = thisWk
      ? `This week's average: <strong>${mmss(thisWk)}</strong>${imp != null ? ` · <strong>${imp >= 0 ? imp + "% shorter" : -imp + "% longer"}</strong> than last week` : " · log another week to see your improvement"}${streak ? ` · 🔥 ${streak}-shower streak under ${GOAL_TXT}` : ""}`
      : "Log a shower to see your progress here.";
  }

  /* ---------- StatCan benchmark (Alberta average home water use) ---------- */
  async function loadStatcan() {
    try {
      const r = await fetch("/api/statcan"); if (!r.ok) throw new Error(r.status);
      S.benchmark = await r.json();
    } catch { S.benchmark = null; }
    renderBenchmark();
  }
  function renderBenchmark() {
    const el = $("#benchmark"), btn = $("#useBenchmarkBtn"), b = S.benchmark?.alberta;
    if (!b) { el.hidden = true; btn.hidden = true; return; }
    const n = S.settings?.household || 1, perPersonToday = dayTotal() / n;
    el.hidden = false;
    el.innerHTML = `📊 The average Albertan uses <strong>${b.litres} L</strong> per day at home` +
      (S.benchmark.canada ? ` (Canada: ${S.benchmark.canada.litres} L)` : "") +
      `. Your household today: <strong>${Math.round(perPersonToday)} L per person</strong>. ` +
      `<small class="muted">Statistics Canada, Table 38-10-0271-01 (${b.year}).</small>`;
    btn.hidden = false;
    btn.textContent = `Use the Alberta average (${b.litres} L) as my goal`;
    btn.onclick = () => { $("#setPerPerson").value = b.litres; };
  }

  /* ---------- community: Discord ---------- */
  const D = C.discord;
  const timeAgo = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  async function loadDiscordWidget() {
    const join = $("#discordJoin");
    if (D.inviteUrl) { join.href = D.inviteUrl; join.hidden = false; }
    if (!D.guildId) { $("#discordOnline").textContent = "Discord server not connected yet (add guildId in data/config.js)."; return; }
    try {
      const r = await fetch(`https://discord.com/api/guilds/${D.guildId}/widget.json`);
      if (!r.ok) throw new Error(r.status);
      const w = await r.json();
      $("#discordName").textContent = w.name || "DropWise YYC Community";
      $("#discordOnline").innerHTML = `<span class="online-dot" aria-hidden="true"></span>${w.presence_count ?? 0} neighbours online now`;
      if (!D.inviteUrl && w.instant_invite) { join.href = w.instant_invite; join.hidden = false; }
    } catch { $("#discordOnline").textContent = "Couldn't reach Discord. Is the Server Widget enabled?"; }
  }
  function renderChannels() {
    $("#discordChannels").innerHTML = D.channels.map((ch) => {
      const href = D.guildId && ch.id ? `https://discord.com/channels/${D.guildId}/${ch.id}` : D.inviteUrl;
      const inner = `<span aria-hidden="true">${ch.icon}</span><span><strong>#${esc(ch.name)}</strong><small>${esc(ch.desc)}</small></span>`;
      return `<li>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="ch">${inner}</div>`}</li>`;
    }).join("");
  }
  async function loadFeed() {
    const feed = $("#discordFeed");
    try {
      const r = await fetch("/api/discord"); if (!r.ok) throw new Error(r.status);
      const { posts } = await r.json();
      feed.innerHTML = posts.length ? posts.map((p) => `<li class="post"><span class="who">${esc(p.author)}</span><span class="when">${timeAgo(p.time)}</span><p>${esc(p.text)}</p></li>`).join("")
        : "<li class='muted'>No posts yet — be the first to share a tip!</li>";
    } catch {
      feed.innerHTML = "<li class='muted'>Live posts appear here once the Discord bot is connected (see README).</li>";
    }
  }
  async function postToDiscord(payload) {
    const r = await fetch("/api/discord", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, community: S.settings?.community }) });
    if (!r.ok) { let m = "Couldn't post right now."; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
  }
  $("#tipText").addEventListener("input", (e) => { $("#tipCount").textContent = `${e.target.value.length} / 280`; });
  $("#tipForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("#tipText").value.trim(), msg = $("#tipMsg");
    if (text.length === 0) { msg.textContent = "Please enter a tip."; return; }
    msg.textContent = "Posting…";
    try {
      await postToDiscord({ type: "tip", text });
      $("#tipText").value = ""; $("#tipCount").textContent = "0 / 280";
      msg.textContent = "✅ Posted to #water-saving-tips. Thanks for helping your neighbours!";
      setTimeout(loadFeed, 1500);
    } catch (err) {
      try { await navigator.clipboard.writeText(text); msg.textContent = `${err.message} Your tip was copied — paste it in #water-saving-tips on Discord.`; }
      catch { msg.textContent = `${err.message} Please paste your tip in #water-saving-tips on Discord.`; }
    }
  });
  /* ---------- Calgary map (City of Calgary Open Data — Community District Boundaries GeoJSON) ---------- */
  const Q = C.quadrants;
  function riverLatAt(lon) { // N/S dividing line: Bow River west of downtown, then Centre Ave / Memorial Dr
    const r = Q.river;
    if (lon <= r[0][0]) return r[0][1];
    for (let i = 1; i < r.length; i++) if (lon <= r[i][0]) {
      const [x0, y0] = r[i - 1], [x1, y1] = r[i]; return y0 + ((y1 - y0) * (lon - x0)) / (x1 - x0);
    }
    return r[r.length - 1][1];
  }
  function quadrantAt(lon, lat) {
    const north = lat >= riverLatAt(lon);
    const east = lon >= (north ? Q.ewLonNorth : Q.ewLonSouth);
    return (north ? "N" : "S") + (east ? "E" : "W");
  }
  S.map = null;
  async function loadMapData() {
    try {
      const r = await fetch("https://data.calgary.ca/resource/surr-xmvs.geojson?$limit=500");
      if (!r.ok) throw new Error(r.status);
      const gj = await r.json(), feats = [];
      for (const f of gj.features || []) {
        const g = f.geometry, name = f.properties?.name; if (!g || !name) continue;
        const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
        const rings = polys.map((p) => p[0]).filter((ring) => ring && ring.length > 2);
        if (!rings.length) continue;
        let sx = 0, sy = 0, n = 0; rings.forEach((ring) => ring.forEach(([x, y]) => { sx += x; sy += y; n++; }));
        const q = quadrantAt(sx / n, sy / n);
        feats.push({ name, q, rings });
        const cls = f.properties?.class || "";
        if (!cls || /residential/i.test(cls)) S.commQuad[name.toUpperCase()] = q;
      }
      if (feats.length) S.map = { features: feats };
    } catch { /* offline: simplified map */ }
    renderMap();
  }
  const PALETTE = ["#2e7d32", "#f6c026", "#fb8c00", "#e53935"]; // lowest use → highest use
  function quadRows() { return [...(S.ranking?.quadrants || [])].filter((r) => r.lpd != null).sort((a, b) => a.lpd - b.lpd); }
  function quadColors() {
    const rows = quadRows(), col = {};
    rows.forEach((r, i) => { col[r.q] = PALETTE[Math.round((i * (PALETTE.length - 1)) / Math.max(1, rows.length - 1))]; });
    return col;
  }
  /* Real map (Leaflet + CARTO/OpenStreetMap tiles) with a 40% colour overlay. Falls back to the SVG map if Leaflet can't load. */
  const OVERLAY_OPACITY = 0.4;
  let lmap = null, overlay = null;
  function quadrantPolygons() { // approximate NW/NE/SW/SE shapes, used when community boundaries can't load
    const W = -114.32, E = -113.86, N = 51.215, Sth = 50.84, ewN = Q.ewLonNorth, ewS = Q.ewLonSouth;
    const pts = (from, to) => [[riverLatAt(from), from], ...Q.river.filter(([x]) => x > from && x < to).map(([x, y]) => [y, x]), [riverLatAt(to), to]];
    const west = pts(W, ewN), east = pts(ewN, E);
    return {
      NW: [[N, W], [N, ewN], ...[...west].reverse()],
      SW: [...west, [Sth, ewS], [Sth, W]],
      NE: [[N, ewN], [N, E], ...[...east].reverse()],
      SE: [...east, [Sth, E], [Sth, ewS]]
    };
  }
  function renderLeaflet(box, col, byQ, lbl) {
    if (!lmap) {
      box.classList.add("leaflet-on");
      lmap = L.map(box, { center: [51.045, -114.07], zoom: 10, minZoom: 9, maxZoom: 16, scrollWheelZoom: false });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd", maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      }).addTo(lmap);
      lmap.on("click", () => lmap.scrollWheelZoom.enable());
      lmap.on("mouseout", () => lmap.scrollWheelZoom.disable());
    }
    if (overlay) overlay.remove();
    overlay = L.layerGroup().addTo(lmap);
    const myComm = (S.settings?.community || "").toUpperCase(), myQ = quadOf(S.settings?.community);
    const style = (q) => ({ fillColor: col[q] || "#90a4ae", fillOpacity: OVERLAY_OPACITY, color: col[q] || "#90a4ae", weight: 0.8, opacity: 0.7 });
    const tipFor = (name, q) => `<strong>${esc(name)}</strong><br>${Q.names[q]} (${q})${byQ[q]?.lpd != null ? `<br>${byQ[q].lpd} L per person/day` : ""}`;
    const cent = { NW: [0, 0, 0], NE: [0, 0, 0], SW: [0, 0, 0], SE: [0, 0, 0] };
    const bounds = [];
    if (S.map) {
      for (const f of S.map.features) {
        const latlngs = f.rings.map((r) => r.map(([x, y]) => [y, x]));
        L.polygon(latlngs, style(f.q)).bindTooltip(tipFor(titleCase(f.name), f.q), { sticky: true }).addTo(overlay);
        f.rings[0].forEach(([x, y]) => { cent[f.q][0] += y; cent[f.q][1] += x; cent[f.q][2]++; bounds.push([y, x]); });
        if (f.name.toUpperCase() === myComm)
          L.polygon(latlngs, { fill: false, color: "#111", weight: 3, dashArray: "6 4" }).bindTooltip(tipFor(titleCase(f.name) + " (you)", f.q)).addTo(overlay);
      }
      $("#mapNote").textContent = `${S.map.features.length} communities`;
    } else {
      const polys = quadrantPolygons();
      for (const q of Object.keys(polys)) {
        L.polygon(polys[q], { ...style(q), weight: q === myQ ? 3 : 1 }).bindTooltip(tipFor(Q.names[q], q), { sticky: true }).addTo(overlay);
        polys[q].forEach(([y, x]) => { cent[q][0] += y; cent[q][1] += x; cent[q][2]++; });
      }
      $("#mapNote").textContent = "Approximate quadrant areas";
    }
    for (const q of Object.keys(cent)) {
      const [sy, sx, n] = cent[q]; if (!n) continue;
      L.marker([sy / n, sx / n], { interactive: false, keyboard: false,
        icon: L.divIcon({ className: "q-marker", html: `<span style="--c:${col[q] || "#607d8b"}">${esc(lbl(q))}</span>`, iconSize: null }) }).addTo(overlay);
    }
    if (bounds.length && !lmap._dwFitted) { lmap.fitBounds(bounds, { padding: [10, 10] }); lmap._dwFitted = true; }
    setTimeout(() => lmap.invalidateSize(), 0);
  }

  function renderMap() {
    const box = $("#cityMap"); if (!box) return;
    if (window.L && typeof L.map === "function") {
      const col = quadColors(), byQ = Object.fromEntries((S.ranking?.quadrants || []).map((r) => [r.q, r]));
      const lbl = (q) => `${q}${byQ[q]?.lpd != null ? " · " + byQ[q].lpd + " L" : ""}`;
      try { return renderLeaflet(box, col, byQ, lbl); } catch (e) { console.warn("Leaflet map failed, using SVG map", e); }
    }
    renderSvgMap(box);
  }
  function renderSvgMap(box) {
    const col = quadColors(), byQ = Object.fromEntries((S.ranking?.quadrants || []).map((r) => [r.q, r]));
    const myComm = (S.settings?.community || "").toUpperCase(), myQ = quadOf(S.settings?.community);
    const lbl = (q) => `${q}${byQ[q]?.lpd != null ? " · " + byQ[q].lpd + " L" : ""}`;
    const halo = (x, y, text, size = 22) => `<text x="${x}" y="${y}" text-anchor="middle" class="map-label" font-size="${size}">${esc(text)}</text>`;
    if (!S.map) {
      $("#mapNote").textContent = "Simplified map (live City map unavailable)";
      const quad = (q, x, y) => `<rect x="${x}" y="${y}" width="280" height="200" rx="26" fill="${col[q] || "#cfd8dc"}" class="${q === myQ ? "mine" : ""}"><title>${Q.names[q]}</title></rect>${halo(x + 140, y + 108, lbl(q))}`;
      box.innerHTML = `<svg viewBox="0 0 600 440" aria-hidden="true">${quad("NW", 10, 10)}${quad("NE", 310, 10)}${quad("SW", 10, 230)}${quad("SE", 310, 230)}
        <path d="M0 222 Q150 200 300 222 T600 216" stroke="#3ea0e6" stroke-width="10" fill="none" opacity=".9"/>
        </svg>`;
      return;
    }
    $("#mapNote").textContent = `${S.map.features.length} communities`;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    S.map.features.forEach((f) => f.rings.forEach((r) => r.forEach(([x, y]) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    })));
    const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180), W = 600;
    const H = Math.round((W * (maxY - minY)) / ((maxX - minX) * k));
    const px = (x) => (((x - minX) / (maxX - minX)) * W).toFixed(1), py = (y) => (H - ((y - minY) / (maxY - minY)) * H).toFixed(1);
    const cent = { NW: [0, 0, 0], NE: [0, 0, 0], SW: [0, 0, 0], SE: [0, 0, 0] };
    let paths = "", mine = "";
    for (const f of S.map.features) {
      const d = f.rings.map((r) => "M" + r.map(([x, y]) => px(x) + "," + py(y)).join("L") + "Z").join("");
      const tip = `${titleCase(f.name)} · ${Q.names[f.q]}${byQ[f.q]?.lpd != null ? ` · ${byQ[f.q].lpd} L/person/day` : ""}`;
      const el = `<path d="${d}" fill="${col[f.q] || "#cfd8dc"}"><title>${esc(tip)}</title></path>`;
      if (f.name.toUpperCase() === myComm) mine = `<path d="${d}" class="mine-comm"><title>${esc(tip)} (you)</title></path>`;
      paths += el;
      f.rings[0].forEach(([x, y]) => { cent[f.q][0] += x; cent[f.q][1] += y; cent[f.q][2]++; });
    }
    let labels = "";
    for (const q of Object.keys(cent)) { const [sx, sy, n] = cent[q]; if (n) labels += halo(px(sx / n), py(sy / n), lbl(q)); }
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><g class="communities">${paths}</g>${mine}${labels}</svg>`;
  }

  /* ---------- quadrant challenge ----------
   * Online household: the database ranks every household once (litres per resident from the meter).
   *   Joining is a household setting (owner decides); nothing else is shared.
   * Local mode: optional opt-in posts to Discord #water-challenge (fallback), else demo data. */
  S.autoShare = store.get("autoShare", false);
  const autoBox = $("#autoShare");
  function renderShareToggle() {
    $("#shareLabel").textContent = t(S.hh ? "hh.shareLabel" : "share.join");
    if (S.hh) {
      autoBox.checked = !!S.hh.share_in_ranking;
      autoBox.disabled = S.hh.myRole !== "owner";
      $("#shareMsg").textContent = S.hh.myRole === "owner" ? t("hh.shareOwner") : t("hh.shareMember");
    } else { autoBox.checked = S.autoShare; autoBox.disabled = false; }
  }
  autoBox.addEventListener("change", async () => {
    if (S.hh) {
      if (S.hh.myRole !== "owner") { renderShareToggle(); return; }
      try { const h = await CLOUD.updateHousehold(S.hh.id, { share_in_ranking: autoBox.checked }); S.hh = { ...S.hh, ...h }; loadRanking(); }
      catch (err) { showDataError(err); }
      renderShareToggle(); return;
    }
    S.autoShare = autoBox.checked; store.set("autoShare", S.autoShare);
    const q = quadOf(S.settings?.community);
    $("#shareMsg").textContent = S.autoShare
      ? `You're in! Your daily litres per person will count for ${q ? Q.names[q] + " (" + q + ")" : "your quadrant"}.`
      : "Sharing is off. Your readings stay on this device only.";
    if (S.autoShare) maybeShareUsage();
  });
  async function maybeShareUsage() {
    if (S.hh) { setTimeout(loadRanking, 1000); return; } // the database computes the ranking from meter readings
    if (!S.autoShare) return;
    const used = meterUse(), q = quadOf(S.settings?.community), msg = $("#shareMsg");
    if (used == null) return;
    if (!q) { msg.textContent = "We couldn't find your quadrant — please pick your community in Settings."; return; }
    const k = todayKey();
    if (store.get("sharedDay", "") === k) { msg.textContent = "Today's use is already counted for your quadrant."; return; }
    const lpd = Math.round(used / (S.settings?.household || 1));
    try {
      await postToDiscord({ type: "usage", quadrant: q, lpd });
      store.set("sharedDay", k);
      msg.textContent = `✅ ${lpd} L per person shared to the ${Q.names[q]} ranking.`;
      setTimeout(loadRanking, 2000);
    } catch (e) { msg.textContent = "Couldn't share: " + e.message; }
  }

  async function loadRanking() {
    if (CLOUD.enabled) {
      try {
        const rows = await CLOUD.ranking();
        S.ranking = { quadrants: rows, totals: { reports: rows.reduce((a, r) => a + r.reports, 0), quadrants: rows.length }, demo: false, source: "db" };
        return renderRanking();
      } catch { /* fall back below */ }
    }
    try {
      const r = await fetch("/api/discord?view=ranking"); if (!r.ok) throw new Error(r.status);
      S.ranking = { ...(await r.json()), demo: false, source: "discord" };
    } catch {
      S.ranking = { ...C.demoRanking, demo: true };
    }
    renderRanking();
  }
  function renderRanking() {
    const R = S.ranking; if (!R) return;
    const banner = $("#rankBanner");
    banner.hidden = !R.demo;
    banner.textContent = "Demo data — connect the Discord bot (see README) to show the live quadrant ranking from #water-challenge.";
    const ch = C.discord.channels.find((c) => c.name === "water-challenge");
    const href = C.discord.guildId && ch?.id ? `https://discord.com/channels/${C.discord.guildId}/${ch.id}` : C.discord.inviteUrl;
    const join = $("#rankJoin"); join.hidden = !href; if (href) join.href = href;

    const rows = quadRows(), col = quadColors(), myQ = quadOf(S.settings?.community);
    const myRank = rows.findIndex((r) => r.q === myQ);
    const t = R.totals || {};
    $("#rankSummary").innerHTML = `
      <div><b>${t.reports ?? 0}</b><span>${R.source === "db" ? "households ranked this week" : "household reports this week"}</span></div>
      <div><b>${rows[0] ? rows[0].q : "—"}</b><span>saving the most water</span></div>
      <div><b>${rows.length ? Math.round(rows.reduce((s, r) => s + r.lpd * r.reports, 0) / Math.max(1, rows.reduce((s, r) => s + r.reports, 0))) + " L" : "—"}</b><span>city average per person/day</span></div>
      <div><b>${!R.demo && myRank >= 0 ? "#" + (myRank + 1) : myQ || "—"}</b><span>${!R.demo && myRank >= 0 ? "your quadrant's rank" : "your quadrant"}</span></div>`;
    const max = Math.max(1, ...rows.map((r) => r.lpd));
    $("#quadRank").innerHTML = rows.map((r, i) => {
      const me = !R.demo && r.q === myQ;
      const ch = r.change == null ? `<span class="muted">new</span>`
        : `<span class="${r.change <= 0 ? "good" : "bad"}">${r.change <= 0 ? "▼" : "▲"} ${Math.abs(r.change)}% vs last week</span>`;
      return `<li class="${me ? "me" : ""}" style="--c:${col[r.q]}">
        <span class="rank-no">${["🥇", "🥈", "🥉"][i] || i + 1}</span>
        <div class="q-body">
          <div class="q-head"><strong>${Q.names[r.q]} <small>(${r.q})</small>${me ? " <em>you</em>" : ""}</strong><b>${r.lpd} L</b></div>
          <div class="q-bar"><span style="width:${(r.lpd / max) * 100}%"></span></div>
          <div class="q-meta">${r.reports} ${R.source === "db" ? (r.reports === 1 ? "household" : "households") : (r.reports === 1 ? "report" : "reports")} · ${ch}</div>
        </div></li>`;
    }).join("") || `<li class="muted">No reports yet this week — be the first to join!</li>`;
    renderMap();
  }
  $("#rankRefresh").addEventListener("click", loadRanking);

  /* ---------- community: City 311 water requests (Open Data, no key) ---------- */
  async function load311() {
    const box = $("#open311"), comm = (S.settings?.community || "").toUpperCase();
    if (!comm) return;
    const since = new Date(Date.now() - C.open311.days * 864e5).toISOString().slice(0, 19);
    const where = `service_name like '${C.open311.prefix}%' AND upper(comm_name)='${comm.replace(/'/g, "''")}' AND requested_date > '${since}'`;
    const url = `https://data.calgary.ca/resource/${C.open311.dataset}.json?$select=service_name,count(*) AS n` +
      `&$where=${encodeURIComponent(where)}&$group=service_name&$order=n DESC&$limit=6`;
    try {
      const r = await fetch(url); if (!r.ok) throw new Error(r.status);
      const rows = await r.json();
      box.innerHTML = rows.length
        ? `<ul>${rows.map((x) => `<li>${esc(x.service_name.replace(/^WATS - /, ""))}<b>${x.n}</b></li>`).join("")}</ul>`
        : `<p class="muted">No water-service requests in ${esc(S.settings.community)} in the last ${C.open311.days} days. 👍</p>`;
    } catch { box.innerHTML = `<p class="muted">City 311 data is unavailable right now.</p>`; }
  }

  /* ---------- chatbot ---------- */
  const chat = [];
  const chips = ["How much water can my family of 5 use per day?", "How often should I do laundry?",
    "Can I water my lawn during Stage 4?", "Can I wash my car?", "Should I keep a tap running so my pipes don't freeze?", "When is the construction on 33 Avenue?"];
  $("#chips").innerHTML = chips.map((c) => `<button type="button">${esc(c)}</button>`).join("");
  $("#chips").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") ask(e.target.textContent); });
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#chatInput").value.trim(); if (v) { $("#chatInput").value = ""; ask(v); } });

  function addMsg(role, text, note) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = text;
    if (note) { const s = document.createElement("span"); s.className = "src"; s.textContent = note; div.appendChild(s); }
    $("#chatLog").appendChild(div); $("#chatLog").scrollTop = 1e6;
    return div;
  }
  function context() {
    return {
      today: todayKey(),
      siteLanguage: lang,
      household: S.hh ? { name: S.hh.name, quadrant: S.hh.quadrant, residents: S.hh.residents, appMembers: S.hh.members.length } : null,
      measuredTodayLitres: meterUse() != null ? Math.round(meterUse()) : null,
      estimatedTodayLitres: Math.round(estimatedTotal()),
      household: S.settings?.household, community: S.settings?.community,
      perPersonGoalLitres: S.settings?.perPerson, dailyGoalLitres: budget(), usedTodayLitres: Math.round(dayTotal()),
      usedByCategory: categoryTotals(), // shower (timer) vs rest of home (meter)
      activeEvents: eventsOn(todayKey()).map((e) => e.title),
      upcomingEvents: C.events.filter((e) => e.end >= todayKey()).map((e) => `${e.title}: ${e.start} to ${e.end}${e.approx ? " (approx.)" : ""}`),
      albertaAverageResidentialLitresPerPerson: S.benchmark?.alberta || null,
      quadrant: quadOf(S.settings?.community),
      quadrantRanking: S.ranking ? { demo: S.ranking.demo, quadrants: S.ranking.quadrants } : null,
      meterReadingsToday: S.readings.filter((r) => r.date === todayKey()).length,
      activityLitres: C.activities.map((a) => `${a.label}: ${a.perMinute ? a.perMinute + " L/min" : a.litres + " L"}`)
    };
  }
  async function ask(q) {
    addMsg("user", q); chat.push({ role: "user", content: q });
    const pending = addMsg("bot", "…");
    let answer, note;
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chat.slice(-10), context: context() }) });
      if (!r.ok) throw new Error(r.status);
      answer = (await r.json()).reply; if (!answer) throw new Error("empty");
      note = "AI answer · general guidance, not official City advice";
    } catch {
      answer = offlineAnswer(q); note = "Offline answer (AI server not connected)";
    }
    pending.remove(); addMsg("bot", answer, note); chat.push({ role: "assistant", content: answer });
  }
  function offlineAnswer(q) {
    const s = q.toLowerCase();
    const nMatch = s.match(/(\d+)\s*(people|person|members|of us)|family of (\d+)/);
    const n = nMatch ? +(nMatch[1] || nMatch[3]) : S.settings?.household || 1;
    const per = S.settings?.perPerson || C.defaultPerPersonLitres;
    if (/laundry|wash(ing)? clothes|washer/.test(s)) {
      const every = n >= 5 ? "every 2 days" : n >= 3 ? "every 2–3 days" : "every 4–5 days";
      return `The City asks for full loads only and fewer loads during Stage 4. For a household of ${n}, aim for one full load about ${every} (front-load ≈ 62 L, top-load ≈ 112 L per cycle). Use eco settings, and avoid 4–7 p.m. when Alberta's power grid peaks.`;
    }
    if (/how much|budget|goal|per day|daily/.test(s))
      return `With a goal of ${per} L per person, a household of ${n} has about ${fmtL(per * n)} per day. City-wide, Calgary must stay under 500 million litres a day. A 3-minute shower is about ${fmtL(3 * 9.5)}.`;
    if (/car/.test(s))
      return "Under Stage 4 you can't wash your car with a hose on your driveway or street. Indoor car washes are allowed (the City encourages washing only when needed for safety). Fines start at $3,000.";
    if (/lawn|grass|garden|tree|shrub|flower/.test(s))
      return "No — watering lawns, gardens, trees and shrubs is not allowed by any method under Stage 4. Exception: edible food crops (like vegetables) with a spring-loaded hose nozzle or a hand-held container.";
    if (/rink|ice|skat/.test(s))
      return "Flooding or maintaining outdoor rinks (backyard or community) is not allowed under Stage 4.";
    if (/pool|hot tub|fountain/.test(s))
      return "Filling outdoor pools, hot tubs, wading pools, fountains or decorative water features is not allowed. Bird baths and residential ponds are okay, and indoor pools may operate.";
    if (/fine|penalt|ticket/.test(s)) return "Violations of Stage 4 restrictions may result in fines starting at $3,000. Questions? Call 311.";
    if (/frozen|freeze|pipe/.test(s))
      return "Keep your heat at 15°C or higher and open cabinet doors near pipes. Only if your home has frozen before or you received a City letter should you keep a pencil-thin stream running — that's an exception to saving water.";
    if (/construction|33|89|when|end/.test(s))
      return "Stage 4 started Nov 4 for about four weeks — the City hasn't announced an end date yet.\n" + C.events.filter((e) => e.end >= todayKey()).map((e) => `• ${e.title}: ${niceDate(e.start)} – ${niceDate(e.end)}${e.approx ? " (approx.)" : ""}`).join("\n");
    if (/shower/.test(s)) return "The City asks for showers of about 3 minutes — each minute saved can save up to 8 L. Showering every two days helps too. Try the Shower challenge timer!";
    if (/meter|m3|m³|cubic/.test(s))
      return "Your water meter is usually in the basement or utility room where the water line enters your home. Read the m³ numbers at about the same time each day and save them in 'Read your water meter' — 1 m³ = 1,000 litres. Tip: if the meter moves while no water is running, you may have a leak.";
    if (/quadrant|ranking|challenge|\b(nw|ne|sw|se)\b/.test(s)) {
      const rows = quadRows();
      return rows.length ? `This week's quadrant ranking (lower is better${S.ranking?.demo ? ", demo data" : ""}):\n` + rows.map((r, i) => `${i + 1}. ${Q.names[r.q]} — ${r.lpd} L per person/day`).join("\n") + `\nYour community is in ${quadOf(S.settings?.community) || "an unknown quadrant"}.`
        : "No quadrant reports yet this week. Tick 'Join the quadrant challenge' under your meter reading to take part.";
    }
    if (/toilet|flush/.test(s)) return "Flush only when needed — skipping five flushes saves about 25 L (City of Calgary).";
    return "I can help with restrictions, your household water goal, laundry timing and frozen pipes. For official answers, see calgary.ca/savewater or call 311.";
  }

  /* ---------- hero: city-wide meter + Stage 4 rules ---------- */
  function renderHero() {
    const u = C.cityUsage, max = u.targetML * 1.1, green = u.usedML < u.targetML;
    $("#meterFill").style.width = `${Math.min(100, (u.usedML / max) * 100)}%`;
    $("#meterFill").classList.toggle("red", !green);
    document.querySelector(".meter-limit").style.left = `${(u.targetML / max) * 100}%`;
    const zone = $("#meterZone");
    zone.textContent = green ? "🟢 Green zone" : "🔴 Red zone";
    zone.className = "zone " + (green ? "green" : "red");
    $("#meterText").innerHTML = `<strong>${u.usedML} ML</strong> of the ${u.targetML} ML daily limit · ${esc(u.label)}. ` +
      `<a href="${esc(u.source)}" target="_blank" rel="noopener">Source</a>`;
  }
  function renderRules() {
    const r = C.stage4, li = (a) => a.map((x) => `<li>${esc(x)}</li>`).join("");
    const tr = (k, en) => (lang !== "en" && Array.isArray(I18N[lang]?.[k]) ? I18N[lang][k] : en);
    $("#rulesNo").innerHTML = li(tr("rules.noList", r.notAllowed)); $("#rulesYes").innerHTML = li(tr("rules.yesList", r.allowed)); $("#rulesHome").innerHTML = li(tr("rules.homeList", r.indoorAsks));
    $("#fineChip").textContent = `⚠️ ${t("rules.fine")}`; $("#rulesSource").href = r.source;
  }


  /* ---------- health, well-being, together (Prompt 1) ---------- */
  const HEALTH_MIN = C.healthMinPerPerson || 50; // WHO: ~50–100 L per person per day covers basic needs
  function renderHealth() {
    const el = $("#healthCheck"); if (!el) return;
    const used = dayTotal(), pp = used / Math.max(1, residents()), measured = isMeasured();
    const late = new Date().getHours() >= 20;
    let kind, msg;
    if (used <= 0) { kind = "info"; msg = t("health.empty"); }
    else if (pp < HEALTH_MIN && (measured || late)) { kind = "warn"; msg = t("health.low", { n: Math.round(pp), m: HEALTH_MIN }); }
    else if (pp < HEALTH_MIN) { kind = "info"; msg = t("health.sofar", { n: Math.round(pp) }); }
    else if (used > budget()) { kind = "over"; msg = t("health.over", { n: Math.round(pp) }); }
    else { kind = "ok"; msg = t("health.ok", { n: Math.round(pp) }); }
    el.className = "health-check " + kind;
    el.textContent = msg;
  }
  document.querySelectorAll("[data-feel]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-feel]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const f = b.dataset.feel, box = $("#feelReply");
    box.className = "feel-reply " + f;
    box.innerHTML = `<p>${esc(t("feel.r." + f))}</p>` +
      (f === "worried" ? `<p><a href="#rulesTitle">${esc(t("feel.rulesLink"))}</a></p>` : "") +
      (f === "over" ? `<p><a href="#showerTitle">${esc(t("feel.oneThing"))}</a></p>` : "");
  }));
  function renderTogether() {
    const box = $("#togetherStats"); if (!box) return;
    const day = 864e5, b = budget(), keys = [];
    for (let i = 6; i >= 0; i--) keys.push(dateKey(new Date(Date.now() - i * day)));
    const withData = keys.filter((k) => isMeasured(k) || estimatedTotal(k) > 0);
    const under = withData.filter((k) => dayTotal(k) <= b);
    const saved = withData.reduce((a, k) => a + Math.max(0, b - dayTotal(k)), 0);
    const showers = allShowers().filter((x) => Date.now() - x.ts < 7 * day);
    const short = showers.filter((x) => x.seconds <= GOAL_SEC);
    box.innerHTML = [
      [under.length + " / " + withData.length, t("tog.days")],
      [fmtL(saved), t("tog.saved")],
      [short.length + " / " + showers.length, t("tog.showers")],
    ].map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
    // Kudos: celebrate each person who logged something good this week
    const people = {};
    const bump = (id, k) => { (people[id] ||= { short: 0, logs: 0, meter: 0 })[k]++; };
    short.forEach((x) => bump(x.by || ME, "short"));
    keys.forEach((k) => dayEntries(k).forEach((e) => bump(e.by || ME, "logs")));
    S.readings.filter((r) => Date.now() - r.ts < 7 * day).forEach((r) => bump(r.by || ME, "meter"));
    const items = Object.entries(people).map(([id, p]) => {
      const who = id === ME ? t("tog.you") : firstName(id);
      if (p.short >= 2) return `👏 ${t("tog.k.short", { who, n: p.short })}`;
      if (p.meter >= 1) return `📏 ${t("tog.k.meter", { who, n: p.meter })}`;
      return `🙌 ${t("tog.k.logs", { who, n: p.logs })}`;
    });
    if (under.length >= 3) items.unshift(`🌟 ${t("tog.k.streak", { n: under.length })}`);
    $("#kudosList").innerHTML = items.length ? items.map((x) => `<li>${esc(x)}</li>`).join("") : `<li class="muted">${esc(t("tog.none"))}</li>`;
  }
  function neighbourLists() {
    const r = C.stage4, tr = (k, en) => (lang !== "en" && Array.isArray(I18N[lang]?.[k]) ? I18N[lang][k] : en);
    return { no: tr("rules.noList", r.notAllowed), yes: tr("rules.yesList", r.allowed) };
  }
  $("#nbPrint").addEventListener("click", () => {
    const L = neighbourLists(), li = (a) => a.map((x) => `<li>${esc(x)}</li>`).join("");
    const w = window.open("", "_blank");
    if (!w) { $("#nbMsg").textContent = t("nb.popup"); return; }
    w.document.write(`<!DOCTYPE html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>Stage 4</title>
      <style>body{font-family:system-ui,sans-serif;font-size:20px;line-height:1.5;margin:32px;color:#111}h1{color:#c8102e;font-size:32px;margin:0 0 8px}h2{font-size:24px;margin:20px 0 6px}
      .box{border:3px solid #c8102e;border-radius:16px;padding:20px 28px;max-width:720px}.ess{background:#eef6ff;border-radius:12px;padding:12px 16px;margin-top:16px}</style></head>
      <body><div class="box"><h1>💧 ${esc(t("nb.cardTitle"))}</h1><p>${esc(t("nb.cardIntro"))}</p>
      <h2>🚫 ${esc(t("nb.cardNo"))}</h2><ul>${li(L.no)}</ul>
      <h2>✅ ${esc(t("nb.cardYes"))}</h2><ul>${li(L.yes)}</ul>
      <p class="ess"><strong>${esc(t("nb.cardEss"))}</strong></p>
      <p>☎️ 311 Calgary · 211 Alberta · Distress Centre 403-266-HELP (4357)</p>
      <p style="font-size:14px;color:#555">${esc(t("nb.cardFrom"))} · ${esc(C.stage4.source)}</p></div>
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  });
  $("#nbShare").addEventListener("click", async () => {
    const L = neighbourLists();
    const text = `💧 ${t("nb.cardTitle")}\n${t("nb.cardIntro")}\n\n🚫 ${L.no.slice(0, 4).join("; ")}\n\n${t("nb.cardEss")}\n☎️ 311 · 211\n${C.stage4.source}`;
    try {
      if (navigator.share) { await navigator.share({ text }); $("#nbMsg").textContent = t("nb.sent"); }
      else { await navigator.clipboard.writeText(text); $("#nbMsg").textContent = t("nb.copied"); }
    } catch { /* cancelled */ }
  });

  /* ---------- our household (online) ---------- */
  const fmtCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : "");
  const online = () => CLOUD.enabled && SESSION?.provider === "supabase";
  let unsub = null, reloadTimer = null;
  function hhMsg(text, kind = "") { const el = $("#hhMsg"); if (el) { el.className = "hh-msg " + kind; el.textContent = text; } }
  const errText = (err) => t("err." + (err?.code || "network"));
  const quadOptions = (sel) => ["NW", "NE", "SW", "SE"].map((q) => `<option value="${q}" ${q === sel ? "selected" : ""}>${q} — ${Q.names[q]}</option>`).join("");

  function renderHousehold() {
    const card = $("#hhCard"); if (!card) return;
    if (!CLOUD.enabled) {
      card.innerHTML = `<p class="hh-note">🔌 ${esc(t("hh.offline"))}</p>`; return;
    }
    if (!online()) {
      card.innerHTML = `<div class="hh-empty"><p>${esc(t("hh.loginNeeded"))}</p>
        <button type="button" class="btn-primary" data-action="login">${esc(t("user.login"))}</button></div>`; return;
    }
    if (!S.hh) {
      const myQ = quadOf(S.settings?.community) || "NW";
      card.innerHTML = `
        <div class="hh-choose">
          <form class="hh-panel" id="hhCreate">
            <h3>🏠 ${esc(t("hh.createTitle"))}</h3>
            <p class="muted">${esc(t("hh.createSub"))}</p>
            <label>${esc(t("hh.name"))}<input id="hhName" maxlength="60" required placeholder="${esc(t("hh.namePh"))}" /></label>
            <label>${esc(t("hh.quadrant"))}<select id="hhQuad">${quadOptions(myQ)}</select></label>
            <label>${esc(t("hh.residents"))}<input id="hhResidents" type="number" min="1" max="20" value="${S.settings?.household || 3}" required />
              <small class="muted">${esc(t("hh.residentsHint"))}</small></label>
            <button class="btn-primary" type="submit">${esc(t("hh.create"))}</button>
          </form>
          <form class="hh-panel" id="hhJoin">
            <h3>🔑 ${esc(t("hh.joinTitle"))}</h3>
            <p class="muted">${esc(t("hh.joinSub"))}</p>
            <label>${esc(t("hh.code"))}<input id="hhCode" class="code-input" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-2345" required /></label>
            <button class="btn-primary" type="submit">${esc(t("hh.join"))}</button>
          </form>
        </div>
        <p id="hhMsg" class="hh-msg" role="alert"></p>
        <p class="fineprint">🔒 ${esc(t("hh.privacy"))}</p>`;
      return;
    }
    const h = S.hh, owner = h.myRole === "owner";
    const members = h.members.map((m) => {
      const me = m.id === ME, joined = new Date(m.joined).toLocaleDateString(LOCALE[lang], { month: "short", day: "numeric" });
      const manage = owner && !me
        ? `<span class="m-actions"><button type="button" class="link-btn" data-action="owner" data-id="${m.id}">${esc(t("hh.makeOwner"))}</button>
           <button type="button" class="link-btn danger" data-action="remove" data-id="${m.id}">${esc(t("hh.remove"))}</button></span>` : "";
      return `<li><span class="avatar" aria-hidden="true">${esc((m.name || "?").trim().charAt(0).toUpperCase())}</span>
        <span class="m-name">${esc(m.name)}${me ? ` <small>(${esc(t("hh.you"))})</small>` : ""}</span>
        <span class="role ${m.role}">${esc(t("hh.role." + m.role))}</span>
        <span class="muted m-joined">${esc(t("hh.joined", { d: joined }))}</span>${manage}</li>`;
    }).join("");
    card.innerHTML = `
      <div class="hh-head">
        <div>
          <h3 class="hh-name">${esc(h.name)}</h3>
          <p class="hh-meta"><span class="q-chip">${h.quadrant} · ${esc(Q.names[h.quadrant])}</span>
            <span>👥 ${esc(t("hh.residentsN", { n: h.residents }))}</span>
            <span>📱 ${esc(t("hh.membersN", { n: h.members.length }))}</span></p>
        </div>
        <div class="invite">
          <span class="invite-label">${esc(t("hh.invite"))}</span>
          <code id="inviteCode" class="invite-code">${esc(fmtCode(h.invite_code))}</code>
          <div class="invite-actions">
            <button type="button" class="glass-btn" data-action="copy">📋 ${esc(t("hh.copy"))}</button>
            ${navigator.share ? `<button type="button" class="glass-btn" data-action="share">📤 ${esc(t("hh.share"))}</button>` : ""}
            ${owner ? `<button type="button" class="glass-btn" data-action="regen">🔄 ${esc(t("hh.regen"))}</button>` : ""}
          </div>
        </div>
      </div>
      <h4 class="mini-title">${esc(t("hh.membersTitle"))}</h4>
      <ul class="member-list">${members}</ul>
      ${owner ? `<details class="hh-edit"><summary>${esc(t("hh.edit"))}</summary>
        <form id="hhEdit" class="hh-edit-grid">
          <label>${esc(t("hh.name"))}<input id="hhEditName" maxlength="60" value="${esc(h.name)}" required /></label>
          <label>${esc(t("hh.quadrant"))}<select id="hhEditQuad">${quadOptions(h.quadrant)}</select></label>
          <label>${esc(t("hh.residents"))}<input id="hhEditResidents" type="number" min="1" max="20" value="${h.residents}" required /></label>
          <button class="btn-primary" type="submit">${esc(t("hh.save"))}</button>
        </form></details>` : ""}
      <div class="hh-actions"><button type="button" class="link-btn danger" data-action="leave">🚪 ${esc(t("hh.leave"))}</button></div>
      <p id="hhMsg" class="hh-msg" role="alert"></p>
      <p class="fineprint">🔒 ${esc(t("hh.privacy"))}</p>`;
  }

  async function loadHousehold() {
    if (!online()) { renderHousehold(); return; }
    try {
      const was = S.hh?.id, hh = await CLOUD.myHousehold(ME);
      S.hh = hh;
      if (hh) {
        S.names = Object.fromEntries(hh.members.map((m) => [m.id, m.name]));
        const since = Date.now() - 62 * 864e5;
        const [readings, logs] = await Promise.all([CLOUD.fetchReadings(hh.id, since), CLOUD.fetchLogs(hh.id, since)]);
        S.readings = readings.map((r) => ({ ...r, date: dateKey(new Date(r.ts)) }));
        S.logs = {};
        for (const l of logs) { const k = dateKey(new Date(l.ts)); (S.logs[k] = S.logs[k] || []).push(l); }
        if (was !== hh.id) { S.undo = []; S.redo = []; if (unsub) unsub(); unsub = CLOUD.subscribe(hh.id, scheduleReload); }
      } else if (was) {
        // Left or removed: go back to this device's own records.
        if (unsub) unsub(); unsub = null;
        S.logs = localLogs(); S.readings = localReadings(); S.names = {};
        S.undo = store.get("undo", []).filter((u) => Array.isArray(u.steps)); S.redo = [];
      }
    } catch (err) { renderHousehold(); hhMsg(errText(err), "error"); return; }
    renderHousehold(); renderShareToggle(); renderAll(); loadRanking();
  }
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadHousehold, 400); }

  $("#hhCard").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      if (form.id === "hhCreate") {
        const name = $("#hhName").value.trim(), quad = $("#hhQuad").value, res = Math.round(+$("#hhResidents").value);
        if (!name || !(res >= 1 && res <= 20)) { hhMsg(t("err.invalid_input"), "error"); return; }
        await CLOUD.createHousehold(name, quad, res);
        await loadHousehold(); hhMsg(t("hh.created"), "ok");
      } else if (form.id === "hhJoin") {
        const code = $("#hhCode").value.trim();
        if (code.replace(/[^A-Za-z0-9]/g, "").length < 8) { hhMsg(t("err.invalid_code"), "error"); $("#hhCode").focus(); return; }
        const h = await CLOUD.joinHousehold(code);
        await loadHousehold(); hhMsg(t("hh.joinedMsg", { name: h.name }), "ok");
      } else if (form.id === "hhEdit") {
        const patch = { name: $("#hhEditName").value.trim(), quadrant: $("#hhEditQuad").value, residents: Math.round(+$("#hhEditResidents").value) };
        if (!patch.name || !(patch.residents >= 1 && patch.residents <= 20)) { hhMsg(t("err.invalid_input"), "error"); return; }
        const h = await CLOUD.updateHousehold(S.hh.id, patch);
        S.hh = { ...S.hh, ...h }; renderHousehold(); renderAll(); loadRanking(); hhMsg(t("hh.saved"), "ok");
      }
    } catch (err) {
      hhMsg(errText(err), "error");
      if (form.id === "hhJoin") $("#hhCode")?.focus();
    }
  });
  $("#hhCard").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-action]"); if (!b) return;
    const action = b.dataset.action, h = S.hh, member = h?.members.find((m) => m.id === b.dataset.id);
    try {
      if (action === "login") {
        try { localStorage.removeItem("dw_guest"); localStorage.removeItem("dw_session"); } catch {}
        location.href = "login.html";
      } else if (action === "copy") {
        try { await navigator.clipboard.writeText(fmtCode(h.invite_code)); hhMsg(t("hh.copied"), "ok"); }
        catch { const r = document.createRange(); r.selectNodeContents($("#inviteCode")); getSelection().removeAllRanges(); getSelection().addRange(r); hhMsg(t("hh.copyManual")); }
      } else if (action === "share") {
        await navigator.share({ title: "DropWise YYC", text: t("hh.shareMsg", { code: fmtCode(h.invite_code) }), url: new URL("login.html", location.href).href }).catch(() => {});
      } else if (action === "regen") {
        if (!confirm(t("hh.regenConfirm"))) return;
        const code = await CLOUD.regenerateCode(h.id); S.hh = { ...h, invite_code: code }; renderHousehold(); hhMsg(t("hh.regenDone"), "ok");
      } else if (action === "remove" && member) {
        if (!confirm(t("hh.removeConfirm", { n: member.name }))) return;
        await CLOUD.removeMember(h.id, member.id); await loadHousehold();
      } else if (action === "owner" && member) {
        if (!confirm(t("hh.makeOwnerConfirm", { n: member.name }))) return;
        await CLOUD.transferOwnership(h.id, member.id); await loadHousehold();
      } else if (action === "leave") {
        const alone = h.members.length === 1;
        if (h.myRole === "owner" && !alone) { hhMsg(t("err.owner_must_transfer"), "error"); return; }
        if (!confirm(alone ? t("hh.deleteConfirm") : t("hh.leaveConfirm"))) return;
        const res = await CLOUD.leave(); await loadHousehold();
        hhMsg(res === "household_deleted" ? t("hh.deleted") : t("hh.left"), "ok");
      }
    } catch (err) { hhMsg(errText(err), "error"); }
  });
  $("#hhCard").addEventListener("input", (e) => { // format the invite code as XXXX-XXXX while typing
    if (e.target.id !== "hhCode") return;
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    e.target.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
  });

  /* ---------- account button ---------- */
  function renderUser() {
    const b = $("#userBtn");
    b.querySelector(".user-name").textContent = SESSION ? SESSION.name.split(" ")[0] : t("user.guest");
    b.title = SESSION ? `${SESSION.name}${SESSION.email ? " · " + SESSION.email : ""} — ${t("user.logout")}` : t("user.login");
    if (SESSION?.picture) { const img = b.querySelector("img"); img.src = SESSION.picture; img.hidden = false; }
  }
  $("#userBtn").addEventListener("click", async () => {
    if (SESSION && !confirm(t("user.confirmLogout"))) return;
    if (SESSION?.provider === "supabase") { try { await CLOUD.signOut(); } catch {} }
    try { localStorage.removeItem("dw_session"); localStorage.removeItem("dw_guest"); } catch {}
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch {}
    location.href = "login.html";
  });

  /* ---------- boot ---------- */
  function renderAll() { $("#demoBtn").hidden = cloudOn(); renderStatus(); renderMeterInfo(); renderTank(); renderTodayLog(); renderHistoryButtons(); renderDonut(); renderCalendar(); renderShowers(); renderInbox(); renderBenchmark(); renderRanking(); renderHealth(); renderTogether(); }
  function setLanguage(next) {
    lang = I18N[next] ? next : "en"; store.set("lang", lang);
    applyStaticText(); renderQuickAdd(); renderRules(); renderUser(); renderHousehold(); renderShareToggle(); renderAll(); setShowerUi();
    const hello = document.querySelector("#chatLog .msg.bot.hello"); if (hello) hello.textContent = t("chat.hello");
  }
  $("#langSelect").addEventListener("change", (e) => setLanguage(e.target.value));
  applyStaticText(); applyZoom(); renderUser();
  renderQuickAdd(); renderChannels(); renderHero(); renderRules();
  addMsg("bot", t("chat.hello")).classList.add("hello");
  const firstVisit = !S.settings;
  if (!S.settings) S.settings = { household: 3, perPerson: C.defaultPerPersonLitres, community: C.fallbackCommunities[0].name };
  Promise.all([loadCommunities(), loadStatcan()]).then(() => {
    if (!firstVisit) return;
    openSettings();
    if (S.benchmark?.alberta) $("#setPerPerson").value = S.benchmark.alberta.litres; // cited default for new users
  });
  renderAll(); setShowerUi();
  renderHousehold(); renderShareToggle(); loadHousehold();
  loadNews(); loadRanking(); loadDiscordWidget(); loadFeed(); load311();
})();
