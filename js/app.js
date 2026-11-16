"use strict";
/* ============================================================
   ئامادەبوونی منداڵەکەم — Parent app
   Firebase (compat SDK) + hash router + bottom-tab navigation
   ============================================================ */

const APP_VERSION = "2.0.0";

const firebaseConfig = {
  apiKey: "AIzaSyAsDs_tQemRJwwjH0m8U2YvlqZjWXHEO0k",
  databaseURL: "https://test-school-53999-default-rtdb.firebaseio.com",
  projectId: "test-school-53999",
  storageBucket: "test-school-53999.firebasestorage.app",
  appId: "1:847312056047:web:44f84a1bb21e49d0b7751a"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// Anonymous sign-in; listeners start only after it settles (rules usually need auth != null)
const authReady = auth.signInAnonymously()
  .catch(e => console.warn("auth:", e && e.message))
  .then(() => undefined);

/* ---------------- constants ---------------- */
const STATUS_META = {
  present:       { label: "ئامادەیە ✅",          color: "var(--present)", icon: "✔" },
  absent:        { label: "ئامادە نییە ❌",        color: "var(--absent)",  icon: "✖" },
  "forgot-card": { label: "کارتی لەبیرکردووە 💳", color: "var(--forgot)",  icon: "💳" },
  leave:         { label: "مۆڵەتە 🟡",            color: "var(--leave)",   icon: "📝" },
  waiting:       { label: "چاوەڕوانە ⏳",          color: "var(--waiting)", icon: "⏳" }
};
const KURDISH_DAYS = { 0: "یەکشەممە", 1: "دووشەممە", 2: "سێشەممە", 3: "چوارشەممە", 4: "پێنجشەممە", 5: "هەینی", 6: "شەممە" };
const ROUTES = ["home", "alerts", "settings", "child"];
const MAX_ALERTS = 50;

/* ---------------- small helpers ---------------- */
const $ = (id) => document.getElementById(id);

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
  catch (e) { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn("storage:", e.message); }
}

// NOTE: the school system (scanner/admin) writes attendance under the UTC date
// (new Date().toISOString().slice(0,10)); this app must use exactly the same key.
function dayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }
function todayStr() { return dayKey(Date.now()); }

function formatTodayDate() {
  const d = new Date();
  return `${KURDISH_DAYS[d.getDay()]} - ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function pad2(n) { return String(n).padStart(2, "0"); }
function formatTime(raw) {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return `کاتژمێر ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function formatWhen(ts) {
  const d = new Date(ts);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (dayKey(ts) === todayStr()) return `ئەمڕۆ ${hm}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2400);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------------- state ---------------- */
let linked = loadJSON("linkedStudents", [])
  .filter(s => s && typeof s.cardId === "string" && s.cardId)
  .map(s => ({ cardId: s.cardId, linkCode: s.linkCode || null, name: s.name || "", className: s.className || "", addedAt: s.addedAt || 0 })); // imageUrl (base64) is never persisted
let activity = loadJSON("activityLog", []);
let liveData = {};           // cardId -> { student, attendance, refs, attReady }
let openCardId = null;
let currentDay = todayStr();
let historyToken = 0;

function saveLinked() { saveJSON("linkedStudents", linked); }
function saveActivity() { saveJSON("activityLog", activity); }
function alertsSeen() { return Number(localStorage.getItem("alertsSeen") || 0); }

/* ============================================================
   Navigation: hash router + bottom tabs + Android back button
   ============================================================ */
const sheets = [];   // stack of open sheet ids

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/");
  const name = ROUTES.includes(parts[0]) ? parts[0] : "home";
  let arg = "";
  try { arg = decodeURIComponent(parts.slice(1).join("/")); } catch (e) { arg = ""; }
  return { name, arg };
}

function go(hash, replace) {
  const state = replace ? null : { nav: true };
  if (replace) history.replaceState(state, "", hash);
  else history.pushState(state, "", hash);
  route();
}

function route() {
  const { name, arg } = parseHash();
  if (name === "child") {
    if (!linked.some(s => s.cardId === arg)) { go("#/home", true); return; }
    openCardId = arg;
  } else {
    openCardId = null;
  }

  const viewId = name === "child" ? "view-detail" : "view-" + name;
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === viewId));
  document.body.classList.toggle("in-detail", name === "child");
  document.querySelectorAll("#tabbar a").forEach(a => a.classList.toggle("active", a.dataset.tab === name));
  window.scrollTo(0, 0);

  if (name === "home") renderHome();
  if (name === "alerts") renderAlerts();
  if (name === "settings") renderSettings();
  if (name === "child") { renderDetailHeader(); renderDetailToday(); loadHistory(arg); }
  updateBadge();
}

function goBack() {
  if (history.state && history.state.nav) history.back();
  else go("#/home", true);
}

/* ---- sheets (bottom modals) participate in history so Back closes them ---- */
function openSheet(id) {
  $(id).classList.add("open");
  sheets.push(id);
  history.pushState({ sheet: id, nav: !!(history.state && history.state.nav) }, "");
}
function closeSheet(id) {
  return new Promise(resolve => {
    $(id).classList.remove("open");
    const i = sheets.lastIndexOf(id);
    if (i > -1) sheets.splice(i, 1);
    if (history.state && history.state.sheet === id) {
      let done = false;
      const finish = () => { if (done) return; done = true; window.removeEventListener("popstate", finish); resolve(); };
      window.addEventListener("popstate", finish);
      setTimeout(finish, 400);
      history.back();
    } else resolve();
  });
}

window.addEventListener("popstate", () => {
  if (sheets.length) {                       // hardware Back closes the top sheet first
    const id = sheets.pop();
    $(id).classList.remove("open");
    if (id === "confirmOverlay") confirmAction = null;
    return;
  }
  route();
});
window.addEventListener("hashchange", () => { if (!sheets.length) route(); });

/* ============================================================
   Rendering
   ============================================================ */
function safeImageUrl(u) {
  u = (u || "").toString().trim();
  return /^(data:image\/|https:\/\/)/i.test(u) ? u : "";
}
function initialsAvatar(name) {
  const ch = (name || "").toString().trim().charAt(0) || "؟";
  return el("div", "avatar", ch);
}
function makeAvatar(student) {
  const url = safeImageUrl(student.imageUrl);
  if (!url) return initialsAvatar(student.name);
  const img = el("img", "avatar");
  img.alt = "";
  img.addEventListener("error", () => img.replaceWith(initialsAvatar(student.name)), { once: true });
  img.src = url;
  return img;
}
function displayName(student) {
  return ((student && student.name) || "").toString().trim() || "قوتابی";
}
function studentOf(cardId) {
  const live = liveData[cardId] && liveData[cardId].student;
  const saved = linked.find(s => s.cardId === cardId) || {};
  return Object.assign({}, saved, live || {});
}
function attendanceOf(cardId) {
  return (liveData[cardId] && liveData[cardId].attendance) || { status: "waiting", time: null };
}

function renderHome() {
  $("todayDate").textContent = formatTodayDate();
  const list = $("childrenList");
  list.replaceChildren();
  $("emptyState").hidden = linked.length > 0;

  linked.forEach(s => {
    const student = studentOf(s.cardId);
    const meta = STATUS_META[attendanceOf(s.cardId).status] || STATUS_META.waiting;

    const card = el("div", "card");
    card.dataset.id = s.cardId;
    card.setAttribute("role", "button");
    card.tabIndex = 0;

    const info = el("div", "info");
    info.append(el("div", "name", displayName(student)));
    info.append(el("div", "cls", student.className || ""));
    const badge = el("div", "badge", meta.label);
    badge.style.background = meta.color;
    info.append(badge);

    const x = el("button", "unlink", "✕");
    x.type = "button";
    x.title = "لابردن";
    x.dataset.unlink = s.cardId;

    card.append(makeAvatar(student), info, x);
    list.append(card);
  });
}

function renderAlerts() {
  const seen = alertsSeen();
  const list = $("alertsList");
  list.replaceChildren();
  $("alertsEmpty").hidden = activity.length > 0;
  $("clearAlertsBtn").hidden = activity.length === 0;

  activity.forEach(a => {
    const meta = STATUS_META[a.status] || STATUS_META.waiting;
    const row = el("div", "alert-row" + (a.ts > seen ? " unread" : ""));
    const ico = el("div", "ico", meta.icon);
    ico.style.background = meta.color;
    const txt = el("div", "txt");
    txt.append(el("b", null, a.name || "قوتابی"));
    txt.append(document.createTextNode(meta.label));
    txt.append(el("div", "when", formatWhen(a.ts)));
    row.append(ico, txt);
    list.append(row);
  });

  localStorage.setItem("alertsSeen", String(Date.now()));   // mark as read after highlighting
}

function updateBadge() {
  const { name } = parseHash();
  const seen = alertsSeen();
  const n = name === "alerts" ? 0 : activity.filter(a => a.ts > seen).length;
  const b = $("alertsBadge");
  b.hidden = n === 0;
  b.textContent = n > 9 ? "9+" : String(n);
}

function renderDetailHeader() {
  if (!openCardId) return;
  const s = studentOf(openCardId);
  $("detailName").textContent = displayName(s);
  $("detailClass").textContent = s.className || "";
  $("detailAvatar").replaceChildren(makeAvatar(s));
}
function renderDetailToday() {
  if (!openCardId) return;
  const att = attendanceOf(openCardId);
  const meta = STATUS_META[att.status] || STATUS_META.waiting;
  const line = $("detailStatusLine");
  line.textContent = "ئەمڕۆ: " + meta.label;
  line.style.color = meta.color;
  $("detailTimeLine").textContent = att.time || "";
}

function renderSettings() {
  $("appVersion").textContent = APP_VERSION;
  renderInstallSection();
  renderNotifStatus();
  const box = $("settingsChildren");
  if (linked.length === 0) box.textContent = "هیچ منداڵێک نەبەستراوەتەوە.";
  else box.textContent = linked.map(s => displayName(studentOf(s.cardId))).join(" • ");
}

/* ---------------- notifications ---------------- */
function renderNotifStatus() {
  const txt = $("notifStatus"), btn = $("notifBtn");
  if (!("Notification" in window)) {
    txt.textContent = "ئەم وێبگەڕە پشتگیری ئاگادارکردنەوە ناکات.";
    btn.hidden = true;
  } else if (Notification.permission === "granted") {
    txt.textContent = "✅ ئاگادارکردنەوەکان چالاکن.";
    btn.hidden = true;
  } else if (Notification.permission === "denied") {
    txt.textContent = "ڕێگەت نەداوە. لە ڕێکخستنەکانی وێبگەڕ/مۆبایل ڕێگەی پێبدە.";
    btn.hidden = true;
  } else {
    txt.textContent = "ئاگادارکردنەوە ناچالاکە.";
    btn.hidden = false;
  }
}
function enableNotifications() {
  if (!("Notification" in window)) { showToast("ئاگادارکردنەوە پشتگیری ناکرێت لەم وێبگەڕە"); return; }
  Notification.requestPermission().then(perm => {
    showToast(perm === "granted" ? "ئاگادارکردنەوەکان چالاک کران ✅" : "ڕێگەت نەدا بە ئاگادارکردنەوە");
    renderNotifStatus();
  });
}
async function notify(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg && reg.showNotification) {
      await reg.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png", dir: "rtl", lang: "ckb", data: { url: "#/alerts" } });
      return;
    }
  } catch (e) { /* fall through */ }
  try { new Notification(title, { body }); } catch (e) { /* unsupported */ }
}

/* ---------------- install (PWA) ---------------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; renderInstallSection(); });
window.addEventListener("appinstalled", () => { deferredPrompt = null; renderInstallSection(); });

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }

function renderInstallSection() {
  const box = $("installSection");
  if (!box) return;
  box.replaceChildren();
  if (isStandalone()) {
    const d = el("div", "panel-text", "✅ ئەپەکە پێشتر دامەزراوە لەسەر ئەم مۆبایلە");
    box.append(d);
  } else if (deferredPrompt) {
    const b = el("button", "btn primary full", "📲 دامەزاندنی ئەپ لەسەر مۆبایل");
    b.type = "button"; b.dataset.action = "install";
    box.append(b);
  } else if (isIOS()) {
    const d = el("div", "hint-box");
    d.innerHTML = "<b>بۆ دامەزاندن لەسەر ئایفۆن:</b><br>١. دوگمەی هاوبەشکردن ⬆️ لە سافاری دابگرە<br>٢. «Add to Home Screen» هەڵبژێرە<br>٣. «Add» دابگرە";
    box.append(d);
  } else {
    const d = el("div", "hint-box");
    d.innerHTML = "<b>بۆ دامەزاندنی دەستی:</b><br>دوگمەی سێ خاڵ (⋮) لە کڕۆم دابگرە ← «Install app» یان «Add to Home screen» هەڵبژێرە.";
    box.append(d);
  }
}
function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.finally(() => { deferredPrompt = null; renderInstallSection(); });
}

/* ============================================================
   Firebase listeners
   ============================================================ */
let dbErrorShown = false;
function onDbError(e) {
  console.warn("db:", e && e.message);
  if (!dbErrorShown) { dbErrorShown = true; showToast("نەتوانرا پەیوەندی بە داتابەیس بکرێت"); }
}

function detach(cardId) {
  const d = liveData[cardId];
  if (d && d.refs) { d.refs.forEach(([r, cb]) => r.off("value", cb)); d.refs = null; }
}

function attach(cardId) {
  detach(cardId);
  const d = liveData[cardId] = liveData[cardId] || {};
  d.attReady = false;
  if (!d.attendance) d.attendance = { status: "waiting", time: null };

  const sRef = db.ref("students/" + cardId);
  const aRef = db.ref(`attendance/${currentDay}/records/${cardId}`);

  const sCb = (snap) => {
    const v = snap.val() || {};
    const prev = linked.find(s => s.cardId === cardId) || {};
    d.student = {
      cardId,
      name: v.name || prev.name || "",
      className: v.class || prev.className || "",
      imageUrl: v.imageUrl || null,
      linkCode: v.linkCode || prev.linkCode || null
    };
    // keep the persisted copy fresh so the list is right when opened offline
    if (prev.cardId && (prev.name !== d.student.name || prev.className !== d.student.className)) {
      prev.name = d.student.name; prev.className = d.student.className; saveLinked();
    }
    refreshCurrent();
  };

  const aCb = (snap) => {
    const v = snap.val();
    const status = v ? (v.status || "present") : "waiting";
    const time = v && v.time ? formatTime(v.time) : null;
    const prevStatus = d.attendance ? d.attendance.status : "waiting";
    d.attendance = { status, time };

    if (d.attReady && status !== prevStatus && status !== "waiting") {
      const name = displayName(d.student || linked.find(s => s.cardId === cardId));
      const ts = v && v.time && !isNaN(Date.parse(v.time)) ? Date.parse(v.time) : Date.now();
      recordAlert(cardId, name, status, ts);
    }
    d.attReady = true;
    refreshCurrent();
  };

  sRef.on("value", sCb, onDbError);
  aRef.on("value", aCb, onDbError);
  d.refs = [[sRef, sCb], [aRef, aCb]];
}

function refreshCurrent() {
  const { name } = parseHash();
  if (name === "home") renderHome();
  if (name === "child") { renderDetailHeader(); renderDetailToday(); }
  if (name === "settings") renderSettings();
}

function recordAlert(cardId, name, status, ts) {
  activity.unshift({ id: cardId, name, status, ts });
  if (activity.length > MAX_ALERTS) activity.length = MAX_ALERTS;
  saveActivity();
  const meta = STATUS_META[status] || STATUS_META.waiting;
  notify(`ئامادەبوونی ${name}`, meta.label, "att-" + cardId);
  if (parseHash().name === "alerts") renderAlerts();
  updateBadge();
}

function startAll() { linked.forEach(s => attach(s.cardId)); }

// The attendance path contains today's date, so re-attach after midnight (UTC key, like the school system)
function checkRollover() {
  const t = todayStr();
  if (t === currentDay) return;
  currentDay = t;
  Object.keys(liveData).forEach(id => { liveData[id].attendance = { status: "waiting", time: null }; });
  linked.forEach(s => attach(s.cardId));
  if (openCardId) loadHistory(openCardId);
  refreshCurrent();
}
setInterval(checkRollover, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkRollover(); });

/* ============================================================
   Add / remove child
   ============================================================ */
function openAddModal() {
  $("linkCodeInput").value = "";
  $("addErr").hidden = true;
  openSheet("addOverlay");
  setTimeout(() => $("linkCodeInput").focus(), 120);
}
function showAddError(msg) { const e = $("addErr"); e.textContent = msg; e.hidden = false; }

async function findStudent(code) {
  const toStudent = (cardId, v) => ({ cardId, name: v.name || "", className: v.class || "", imageUrl: v.imageUrl || null, linkCode: (v.linkCode || "").toString() || null });
  let found = null, failed = false;

  // 1) by link code (indexed query — add ".indexOn": ["linkCode"] to your rules)
  try {
    const snap = await db.ref("students").orderByChild("linkCode").equalTo(code).limitToFirst(1).once("value");
    snap.forEach(c => { found = toStudent(c.key, c.val() || {}); return true; });
  } catch (e) { failed = true; }

  // 2) by card number (direct read, no full-table download)
  if (!found && /^[A-Za-z0-9_-]{1,64}$/.test(code)) {
    try {
      const s = await db.ref("students/" + code).once("value");
      if (s.exists()) { failed = false; found = toStudent(code, s.val() || {}); }
    } catch (e) { failed = true; }
  }
  if (!found && failed) throw new Error("db");
  return found;
}

async function submitAddStudent() {
  const code = $("linkCodeInput").value.trim();
  if (!code) return showAddError("تکایە کۆدی پەیوەستکردن بنووسە");
  if (linked.some(s => s.cardId === code || (s.linkCode && s.linkCode === code))) return showAddError("ئەم منداڵە پێشتر زیادکراوە");

  $("addErr").hidden = true;
  const btn = $("addSubmitBtn");
  btn.disabled = true; btn.textContent = "گەڕان...";
  try {
    await authReady;
    const found = await findStudent(code);
    if (!found) return showAddError("قوتابی نەدۆزرایەوە");
    if (linked.some(s => s.cardId === found.cardId)) return showAddError("ئەم منداڵە پێشتر زیادکراوە");

    linked.push({ cardId: found.cardId, linkCode: found.linkCode, name: found.name, className: found.className, addedAt: Date.now() });
    saveLinked();
    attach(found.cardId);
    await closeSheet("addOverlay");
    renderHome();
    showToast(`${found.name || "قوتابی"} زیادکرا ✅`);
  } catch (e) {
    showAddError("هەڵەیەک ڕوویدا، ئینتەرنێتەکەت بپشکنە و دووبارە هەوڵ بدەوە");
  } finally {
    btn.disabled = false; btn.textContent = "دۆزینەوە و زیادکردن";
  }
}

let confirmAction = null;
function showConfirm(message, okLabel, action) {
  $("confirmTitle").textContent = message;
  $("confirmOkBtn").textContent = okLabel || "بەڵێ";
  confirmAction = action;
  openSheet("confirmOverlay");
}
async function confirmOk() {
  const action = confirmAction;
  confirmAction = null;
  await closeSheet("confirmOverlay");
  if (action) action();
}
async function confirmCancel() { confirmAction = null; await closeSheet("confirmOverlay"); }

function unlinkStudent(cardId) {
  showConfirm("دڵنیایت لە لابردنی ئەم منداڵە؟", "بەڵێ، لای بدە", () => {
    detach(cardId);
    delete liveData[cardId];
    linked = linked.filter(s => s.cardId !== cardId);
    activity = activity.filter(a => a.id !== cardId);
    saveLinked(); saveActivity();
    if (parseHash().name === "child") go("#/home", true); else route();
    showToast("منداڵ لابرا");
  });
}

function resetAll() {
  showConfirm("هەموو زانیارییەکان دەسڕدرێنەوە. دڵنیایت؟", "بەڵێ، بیسڕەوە", () => {
    Object.keys(liveData).forEach(detach);
    liveData = {}; linked = []; activity = [];
    ["linkedStudents", "activityLog", "alertsSeen"].forEach(k => localStorage.removeItem(k));
    go("#/home", true);
    showToast("زانیارییەکان سڕانەوە");
  });
}

/* ============================================================
   History + stats (detail screen)
   ============================================================ */
function loadHistory(cardId) {
  const token = ++historyToken;
  const list = $("historyList");
  list.replaceChildren(el("div", "empty", "بارکردن..."));
  $("statGrid").replaceChildren();

  const days = 30, dates = [], promises = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const dateStr = dayKey(now - i * 86400000);
    const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
    dates.push({ dateStr, dow, isToday: i === 0 });
    promises.push(db.ref(`attendance/${dateStr}/records/${cardId}`).once("value"));
  }
  authReady.then(() => Promise.all(promises)).then(snaps => {
    if (token !== historyToken || openCardId !== cardId) return;   // user moved on
    const history = snaps.map((snap, i) => {
      const v = snap.val();
      const { dateStr, dow, isToday } = dates[i];
      let status = "waiting", time = null;
      if (v) { status = v.status || "present"; time = v.time ? formatTime(v.time) : null; }
      else if (!isToday && dow !== 5) status = "unrecorded";
      return { dateStr, dayName: KURDISH_DAYS[dow], status, time, isToday };
    });
    renderHistory(history);
    renderStats(history);
  }).catch(() => {
    if (token !== historyToken) return;
    list.replaceChildren(el("div", "empty", "نەتوانرا مێژوو بار بکرێت"));
  });
}

function renderHistory(history) {
  const list = $("historyList");
  list.replaceChildren();
  history.forEach(h => {
    const meta = h.status === "unrecorded" ? { label: "تۆمار نەکراوە", color: "var(--waiting)" } : (STATUS_META[h.status] || STATUS_META.waiting);
    const row = el("div", "hist-row");
    row.append(el("span", "d", `${h.dayName} - ${h.dateStr}`));
    const s = el("span", "s", meta.label + (h.time ? " · " + h.time : ""));
    s.style.background = meta.color;
    row.append(s);
    list.append(row);
  });
}

function renderStats(history) {
  const valid = history.filter(h => h.status !== "waiting" && h.status !== "unrecorded");
  const count = st => valid.filter(h => h.status === st).length;
  const present = count("present"), absent = count("absent"), leave = count("leave"), forgot = count("forgot-card");
  const rate = Math.round((present / Math.max(valid.length, 1)) * 100);

  let streak = 0;                                  // history is newest → oldest
  for (const h of history) {
    if (h.status === "present") streak++;
    else if (h.status !== "waiting" && h.status !== "unrecorded") break;
  }

  const box = (v, t, c) => {
    const b = el("div", "stat-box");
    const vv = el("div", "v", v); vv.style.color = c;
    b.append(vv, el("div", "t", t));
    return b;
  };
  $("statGrid").replaceChildren(
    box(rate + "%", "ڕێژەی ئامادەبوون", "var(--present)"),
    box(present + " ڕۆژ", "ئامادەبوون", "var(--present)"),
    box(absent + " ڕۆژ", "ئامادە نەبوون", "var(--absent)"),
    box(leave + " ڕۆژ", "مۆڵەت", "var(--leave)"),
    box(forgot + " ڕۆژ", "کارتی لەبیرکردوو", "var(--forgot)"),
    box(streak + " ڕۆژ", "زنجیرەی ئێستا", "var(--primary)")
  );
}

/* ============================================================
   Events
   ============================================================ */
document.addEventListener("click", (ev) => {
  const tab = ev.target.closest("#tabbar a");
  if (tab) {
    ev.preventDefault();
    if (parseHash().name !== tab.dataset.tab) go("#/" + tab.dataset.tab, true);
    return;
  }
  const unlink = ev.target.closest("[data-unlink]");
  if (unlink) { ev.stopPropagation(); unlinkStudent(unlink.dataset.unlink); return; }

  const card = ev.target.closest("#childrenList .card");
  if (card) { go("#/child/" + encodeURIComponent(card.dataset.id)); return; }

  const act = ev.target.closest("[data-action]");
  if (!act) return;
  switch (act.dataset.action) {
    case "add": openAddModal(); break;
    case "close-add": closeSheet("addOverlay"); break;
    case "submit-add": submitAddStudent(); break;
    case "back": goBack(); break;
    case "unlink-detail": if (openCardId) unlinkStudent(openCardId); break;
    case "enable-notif": enableNotifications(); break;
    case "install": installApp(); break;
    case "reset-all": resetAll(); break;
    case "clear-alerts":
      activity = []; saveActivity(); renderAlerts(); updateBadge(); break;
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.id === "linkCodeInput") submitAddStudent();
  if (ev.key === "Enter" && ev.target.classList && ev.target.classList.contains("card")) ev.target.click();
});
$("confirmOkBtn").addEventListener("click", confirmOk);
$("confirmCancelBtn").addEventListener("click", confirmCancel);
$("addOverlay").addEventListener("click", (e) => { if (e.target.id === "addOverlay") closeSheet("addOverlay"); });
$("confirmOverlay").addEventListener("click", (e) => { if (e.target.id === "confirmOverlay") confirmCancel(); });

/* ---- online / offline banner ---- */
function syncOnline() { $("offlineBar").hidden = navigator.onLine !== false; }
window.addEventListener("online", syncOnline);
window.addEventListener("offline", syncOnline);

/* ---- service worker ---- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(e => console.warn("sw:", e.message)); });
}

/* ---- boot ---- */
syncOnline();
route();
authReady.then(startAll);
