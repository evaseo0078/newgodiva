/* DropWise YYC — login page.
 * Demo accounts live on this device (localStorage). For a real launch, replace with a hosted auth service
 * (e.g. Firebase Auth or Supabase) so records follow the user across devices.
 */
(async () => {
  "use strict";
  const C = window.DW_CONFIG, I18N = window.DW_I18N || { en: {} };
  const CLOUD = window.DW_CLOUD || { enabled: false };
  const $ = (s) => document.querySelector(s);
  const readJSON = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // Already signed in → straight to the app.
  if (CLOUD.enabled) {
    let s = null; try { s = await CLOUD.session(); } catch {}
    if (s) { location.replace("index.html"); return; }
    try { localStorage.removeItem("dw_session"); } catch {}
  } else if (readJSON("dw_session", null)) { location.replace("index.html"); return; }

  /* ---------- language + text size (shared with the main site) ---------- */
  let lang = I18N[readJSON("dw_lang", "en")] ? readJSON("dw_lang", "en") : "en";
  const zoom = [16, 18.4, 20.8, 23.2][readJSON("dw_zoom", 0)] || 16;
  document.documentElement.style.setProperty("--base", zoom + "px");
  const t = (k) => I18N[lang]?.[k] ?? I18N.en[k] ?? k;
  function applyText() {
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.dataset.en == null) el.dataset.en = el.innerHTML;
      el.innerHTML = (lang === "en" ? null : I18N[lang]?.[el.dataset.i18n]) ?? el.dataset.en;
    });
    $("#langSelect").value = lang;
    $("#modeNote").textContent = CLOUD.enabled ? t("login.noteOnline") : "";
    $("#localNote").hidden = CLOUD.enabled;
  }
  $("#langSelect").addEventListener("change", (e) => { lang = e.target.value; writeJSON("dw_lang", lang); applyText(); });

  /* ---------- helpers ---------- */
  function finish(session) {
    writeJSON("dw_session", session);
    try { localStorage.removeItem("dw_guest"); } catch {}
    location.href = "index.html";
  }
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, "0")).join("");
  async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(`${salt}:${password}`);
    if (crypto?.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 0x811c9dc5; for (const b of data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return "fnv-" + h.toString(16); // fallback only
  }
  const showError = (key) => { $("#loginError").className = "login-error"; $("#loginError").textContent = key ? t(key) : ""; };
  const showInfo = (key) => { $("#loginError").className = "login-error info"; $("#loginError").textContent = t(key); };
  const cloudSession = (user) => ({ id: user.id, email: user.email, provider: "supabase",
    name: user.user_metadata?.full_name || user.user_metadata?.name || (user.email || "").split("@")[0] });

  /* ---------- email sign-in / create account ---------- */
  let mode = "signin";
  function setMode(m) {
    mode = m;
    $("#nameRow").hidden = m !== "create";
    $("#submitBtn").hidden = m !== "signin"; $("#createSubmit").hidden = m !== "create";
    $("#toCreate").hidden = m !== "signin"; $("#toSignin").hidden = m !== "create";
    $("#password").autocomplete = m === "create" ? "new-password" : "current-password";
    showError(null);
    (m === "create" ? $("#name") : $("#email")).focus();
  }
  $("#toCreate").addEventListener("click", () => setMode("create"));
  $("#toSignin").addEventListener("click", () => setMode("signin"));

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim().toLowerCase(), password = $("#password").value, name = $("#name").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("login.badEmail");
    if (password.length < 8) return showError("login.short");
    if (CLOUD.enabled) { // online accounts (Supabase)
      const btn = mode === "create" ? $("#createSubmit") : $("#submitBtn"); btn.disabled = true;
      try {
        if (mode === "create") {
          if (!name) return showError("login.noName");
          const data = await CLOUD.signUp(email, password, name);
          if (data.session) return finish(cloudSession(data.user));
          return showInfo("login.checkEmail"); // email confirmation is on
        }
        const data = await CLOUD.signIn(email, password);
        return finish(cloudSession(data.user));
      } catch (err) {
        return showError(err.code === "wrong_login" ? "login.wrong" : err.code === "email_taken" ? "login.exists" : "login.network");
      } finally { btn.disabled = false; }
    }
    const accounts = readJSON("dw_accounts", {});
    if (mode === "create") {
      if (!name) return showError("login.noName");
      if (accounts[email]) return showError("login.exists");
      const salt = randomId(), id = "e_" + randomId();
      accounts[email] = { id, name, salt, hash: await hashPassword(password, salt), created: Date.now() };
      writeJSON("dw_accounts", accounts);
      return finish({ id, name, email, provider: "email" });
    }
    const acc = accounts[email];
    if (!acc || (await hashPassword(password, acc.salt)) !== acc.hash) return showError("login.wrong");
    finish({ id: acc.id, name: acc.name, email, provider: "email" });
  });

  /* ---------- guest ---------- */
  $("#guestBtn").addEventListener("click", () => {
    try { localStorage.setItem("dw_guest", "1"); } catch {}
    location.href = "index.html";
  });

  applyText();
  $("#email").focus();
})();
