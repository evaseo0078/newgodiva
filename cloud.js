/* DropWise YYC — online database + accounts (Supabase).
 * Turned on when `supabaseUrl` and `supabaseAnonKey` are set in data/config.js.
 * The anon key is safe to publish: every table is protected by Row Level Security (see supabase/schema.sql).
 * When it's off, the site keeps working in local mode (data stays in this browser).
 */
(() => {
  "use strict";
  const C = window.DW_CONFIG || {};
  const enabled = !!(C.supabaseUrl && C.supabaseAnonKey && window.supabase && window.supabase.createClient);
  const sb = enabled
    ? window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

  // Database errors → short codes the app can translate.
  const CODES = ["invalid_code", "already_in_household", "not_owner", "owner_cannot_remove_self", "owner_must_transfer",
    "not_a_member", "household_full", "not_in_household", "not_authenticated"];
  function toError(error) {
    const msg = String(error?.message || error || "");
    const code = CODES.find((c) => msg.includes(c))
      || (/row-level security|permission denied|forbidden/i.test(msg) ? "forbidden"
      : /check constraint|invalid input/i.test(msg) ? "invalid_input"
      : /invalid login credentials/i.test(msg) ? "wrong_login"
      : /already registered|already exists/i.test(msg) ? "email_taken"
      : "network");
    const e = new Error(code); e.code = code; e.detail = msg; return e;
  }
  async function q(promise) { const { data, error } = await promise; if (error) throw toError(error); return data; }
  const appUrl = () => new URL("index.html", location.href).href;

  const toReading = (r) => ({ id: r.id, ts: new Date(r.read_at).getTime(), value: Number(r.value), unit: r.unit, litres: Number(r.litres), by: r.recorded_by });
  const toLog = (l) => ({ id: l.id, activity: l.activity, litres: Number(l.litres), minutes: l.minutes == null ? undefined : Number(l.minutes),
    source: l.source, ts: new Date(l.logged_at).getTime(), by: l.recorded_by });

  window.DW_CLOUD = {
    enabled, sb, toError,

    /* ---- accounts ---- */
    async session() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; },
    signUp: (email, password, name) => q(sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: appUrl() } })),
    signIn: (email, password) => q(sb.auth.signInWithPassword({ email, password })),
    signInGoogle: () => q(sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: appUrl() } })),
    async signOut() { if (sb) await sb.auth.signOut(); },

    /* ---- household ---- */
    async myHousehold(uid) {
      const m = await q(sb.from("household_members").select("household_id, role").eq("user_id", uid).maybeSingle());
      if (!m) return null;
      const h = await q(sb.from("households").select("*").eq("id", m.household_id).single());
      const members = await q(sb.from("household_members").select("user_id, role, joined_at").eq("household_id", h.id).order("joined_at"));
      const profiles = await q(sb.from("profiles").select("id, display_name").in("id", members.map((x) => x.user_id)));
      const names = Object.fromEntries(profiles.map((p) => [p.id, p.display_name]));
      return { ...h, myRole: m.role, members: members.map((x) => ({ id: x.user_id, role: x.role, joined: x.joined_at, name: names[x.user_id] || "Member" })) };
    },
    createHousehold: (name, quadrant, residents) => q(sb.rpc("create_household", { p_name: name, p_quadrant: quadrant, p_residents: residents })),
    joinHousehold: (code) => q(sb.rpc("join_household", { p_code: code })),
    regenerateCode: (hid) => q(sb.rpc("regenerate_invite_code", { p_household: hid })),
    removeMember: (hid, uid) => q(sb.rpc("remove_member", { p_household: hid, p_user: uid })),
    transferOwnership: (hid, uid) => q(sb.rpc("transfer_ownership", { p_household: hid, p_user: uid })),
    leave: () => q(sb.rpc("leave_household")),
    updateHousehold: (hid, patch) => q(sb.from("households").update(patch).eq("id", hid).select().single()),

    /* ---- records (household-wide; RLS limits them to your own household) ---- */
    async fetchReadings(hid, sinceMs) {
      return (await q(sb.from("meter_readings").select("*").eq("household_id", hid).gte("read_at", new Date(sinceMs).toISOString()).order("read_at"))).map(toReading);
    },
    async fetchLogs(hid, sinceMs) {
      return (await q(sb.from("activity_logs").select("*").eq("household_id", hid).gte("logged_at", new Date(sinceMs).toISOString()).order("logged_at"))).map(toLog);
    },
    addReading: (hid, r) => q(sb.from("meter_readings").insert({ id: r.id, household_id: hid, recorded_by: r.by, read_at: new Date(r.ts).toISOString(), value: r.value, unit: r.unit })),
    async deleteReading(id) { const rows = await q(sb.from("meter_readings").delete().eq("id", id).select("id")); if (!rows.length) throw toError("forbidden"); },
    addLog: (hid, l) => q(sb.from("activity_logs").insert({ id: l.id, household_id: hid, recorded_by: l.by, activity: l.activity, litres: l.litres,
      minutes: l.minutes ?? null, source: l.source || "button", logged_at: new Date(l.ts).toISOString() })),
    async deleteLog(id) { const rows = await q(sb.from("activity_logs").delete().eq("id", id).select("id")); if (!rows.length) throw toError("forbidden"); },

    /* ---- ranking: one value per household, aggregates only (guests can see it too) ---- */
    async ranking() {
      const rows = await q(sb.rpc("quadrant_ranking", { p_min_households: C.rankingMinHouseholds || 1 }));
      return rows.map((r) => ({ q: r.quadrant, lpd: r.avg_lpd, reports: r.households, change: r.change_pct }));
    },

    /* ---- live updates for the household ---- */
    subscribe(hid, onChange) {
      const ch = sb.channel("household-" + hid);
      for (const table of ["meter_readings", "activity_logs", "household_members", "households"]) {
        ch.on("postgres_changes", { event: "*", schema: "public", table, filter: table === "households" ? `id=eq.${hid}` : `household_id=eq.${hid}` }, onChange);
      }
      ch.subscribe();
      return () => sb.removeChannel(ch);
    }
  };
})();
