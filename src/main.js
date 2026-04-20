import "./style.css";
import {
  createSrsEntry,
  reviewCard,
  isDue,
  getDueCount,
  formatInterval,
  migrateSrsData,
} from "./srs.js";
import JA_GLOSS_DATA from "./ja_gloss.json";

/* ========================================
   State
   ======================================== */

const state = {
  kanjiData: [],
  currentIndex: 0,
  knownSet: new Set(),
  ignoredSet: new Set(),
  mode: "study", // study | random | recall | review
  darkMode: true,
  accent: "vermilion", // vermilion | indigo | matcha | sumi
  verticalReadings: false,
  hideReadings: false, // hide meaning/readings (kanji visible)
  hideKanji: false,    // hide kanji character (readings/meaning visible)
  activeView: null, // null | "explorer" | "settings"
  explorerFilter: "all",
  explorerQuery: "",
  srsData: {},
  revealed: false,
  lastAction: null,
  confirmDialog: null,
  strokeOrderSite: "kanjialive",
  lookUpSite: "jisho",
  kanjiFont: "kleeone",
  strokeOrderModal: null,
};

/* ========================================
   External Link Config
   ======================================== */

const STROKE_ORDER_SITES = {
  kanjialive: { label: "Kanji Alive", url: (k) => `https://app.kanjialive.com/${encodeURIComponent(k)}` },
  jisho:      { label: "Jisho",       url: (k) => `https://jisho.org/search/${k}%20%23kanji` },
  strokeorder:{ label: "Stroke Order Navi", url: (k) => `https://kanji-stroke-order.com/kanji/u${k.codePointAt(0).toString(16)}` },
};

const LOOKUP_SITES = {
  jisho:     { label: "Jisho",        url: (k) => `https://jisho.org/search/${k}%20%23kanji` },
  wanikani:  { label: "WaniKani",     url: (k) => `https://www.wanikani.com/kanji/${encodeURIComponent(k)}` },
  kanshudo:  { label: "Kanshudo",     url: (k) => `https://www.kanshudo.com/kanji/${encodeURIComponent(k)}` },
  kanjimap:  { label: "Kanji Map",    url: (k) => `https://thekanjimap.com/${encodeURIComponent(k)}` },
  mojinavi:  { label: "Mojinavi",     url: (k) => `https://mojinavi.com/d/u${k.codePointAt(0).toString(16)}` },
};

const KANJI_FONTS = {
  system:        { label: "既定 (System)",    family: null },
  kleeone:       { label: "Klee One",         family: "Klee One" },
  notosans:      { label: "Noto Sans JP",     family: "Noto Sans JP" },
  notoserif:     { label: "Noto Serif JP",    family: "Noto Serif JP" },
  zenmarugothic: { label: "Zen Maru Gothic",  family: "Zen Maru Gothic" },
  shippori:      { label: "Shippori Mincho",  family: "Shippori Mincho" },
  yomogi:        { label: "Yomogi",           family: "Yomogi" },
  yuseimagic:    { label: "Yusei Magic",      family: "Yusei Magic" },
  hinamincho:    { label: "Hina Mincho",      family: "Hina Mincho" },
  kaiseidecol:   { label: "Kaisei Decol",     family: "Kaisei Decol" },
  dotgothic:     { label: "DotGothic16",      family: "DotGothic16" },
  reggaeone:     { label: "Reggae One",       family: "Reggae One" },
};
const FONT_KEYS = Object.keys(KANJI_FONTS);

const ACCENTS = {
  vermilion: { ja: "朱" },
  indigo:    { ja: "藍" },
  matcha:    { ja: "抹茶" },
  sumi:      { ja: "墨" },
};

const ACCENT_PRESETS = {
  vermilion: {
    dark:  { main: "#E0451F", dim: "#6B2511", soft: "#2A1A14" },
    light: { main: "#C93C18", dim: "#E0A599", soft: "#F6E4DC" },
  },
  indigo: {
    dark:  { main: "#6B7BE0", dim: "#2A3661", soft: "#171B33" },
    light: { main: "#3A4AAA", dim: "#ABB4DC", soft: "#E3E7F4" },
  },
  matcha: {
    dark:  { main: "#8CB885", dim: "#2F4B30", soft: "#152518" },
    light: { main: "#4F7A50", dim: "#B8CBB7", soft: "#E3ECE1" },
  },
  sumi: {
    dark:  { main: "#C9BFA9", dim: "#5C5447", soft: "#2A2620" },
    light: { main: "#5C5447", dim: "#C9C1B3", soft: "#EBE6DC" },
  },
};

const MODES = [
  { id: "study",  ja: "順", tag: "壱" },
  { id: "random", ja: "乱", tag: "弐" },
  { id: "recall", ja: "想", tag: "参" },
  { id: "review", ja: "復", tag: "肆" },
];

// JA gloss table — auto-generated from ja.wiktionary.org via scripts/fetch-ja-gloss.mjs.
// Covers ~87% of the 2140 kanji; missing entries fall back to the primary kun reading.
const JA_GLOSS = JA_GLOSS_DATA;

/* ========================================
   Data
   ======================================== */

async function loadKanjiData() {
  const base = import.meta.env.BASE_URL || "/";
  const res = await fetch(`${base}kanji_sorted.json`);
  const data = await res.json();
  state.kanjiData = data.sort((a, b) => {
    if (a.Frequency === 0 && b.Frequency === 0) return 0;
    if (a.Frequency === 0) return 1;
    if (b.Frequency === 0) return -1;
    return a.Frequency - b.Frequency;
  });
}

/* ========================================
   Persistence
   ======================================== */

function loadState() {
  try {
    const known = localStorage.getItem("nk3_known");
    if (known) state.knownSet = new Set(JSON.parse(known));

    const ignored = localStorage.getItem("nk3_ignored");
    if (ignored) state.ignoredSet = new Set(JSON.parse(ignored));

    const srs = localStorage.getItem("nk3_srs");
    if (srs) {
      const parsed = JSON.parse(srs);
      const { data, changed } = migrateSrsData(parsed);
      state.srsData = data;
      if (changed) localStorage.setItem("nk3_srs", JSON.stringify(state.srsData));
    }

    const theme = localStorage.getItem("nk3_theme");
    if (theme === "light") state.darkMode = false;
    else if (theme === "dark") state.darkMode = true;

    const idx = localStorage.getItem("nk3_index");
    if (idx) state.currentIndex = parseInt(idx, 10) || 0;

    const mode = localStorage.getItem("nk3_mode");
    if (mode && MODES.some((m) => m.id === mode)) state.mode = mode;

    const accent = localStorage.getItem("nk3_accent");
    if (accent && ACCENTS[accent]) state.accent = accent;

    const vr = localStorage.getItem("nk3_vertical");
    if (vr === "true") state.verticalReadings = true;
    else if (vr === "false") state.verticalReadings = false;

    const hr = localStorage.getItem("nk3_hideReadings");
    if (hr === "true") state.hideReadings = true;

    const hk = localStorage.getItem("nk3_hideKanji");
    if (hk === "true") state.hideKanji = true;

    const strokeSite = localStorage.getItem("nk3_strokeOrderSite");
    if (strokeSite && STROKE_ORDER_SITES[strokeSite]) state.strokeOrderSite = strokeSite;

    const lookUpSite = localStorage.getItem("nk3_lookUpSite");
    if (lookUpSite && LOOKUP_SITES[lookUpSite]) state.lookUpSite = lookUpSite;

    const kanjiFont = localStorage.getItem("nk3_kanjiFont");
    if (kanjiFont && KANJI_FONTS[kanjiFont]) state.kanjiFont = kanjiFont;
  } catch {
    // ignore corrupt data
  }
  applyKanjiFont(state.kanjiFont);
  applyTheme(state.darkMode);
  applyAccent(state.accent, state.darkMode);
}

function saveKnown() { localStorage.setItem("nk3_known", JSON.stringify([...state.knownSet])); }
function saveIgnored() { localStorage.setItem("nk3_ignored", JSON.stringify([...state.ignoredSet])); }
function saveSrs()   { localStorage.setItem("nk3_srs", JSON.stringify(state.srsData)); }
function saveTheme() { localStorage.setItem("nk3_theme", state.darkMode ? "dark" : "light"); }
function saveIndex() { localStorage.setItem("nk3_index", String(state.currentIndex)); }
function saveMode()  { localStorage.setItem("nk3_mode", state.mode); }
function saveAccent(){ localStorage.setItem("nk3_accent", state.accent); }
function saveVertical(){ localStorage.setItem("nk3_vertical", String(state.verticalReadings)); }
function saveHideReadings(){ localStorage.setItem("nk3_hideReadings", String(state.hideReadings)); }
function saveHideKanji(){ localStorage.setItem("nk3_hideKanji", String(state.hideKanji)); }
function saveSitePrefs() {
  localStorage.setItem("nk3_strokeOrderSite", state.strokeOrderSite);
  localStorage.setItem("nk3_lookUpSite", state.lookUpSite);
}
function saveFont() { localStorage.setItem("nk3_kanjiFont", state.kanjiFont); }

function applyKanjiFont(key) {
  const font = KANJI_FONTS[key];
  if (!font || !font.family) {
    document.documentElement.style.removeProperty("--kanji-font");
    return;
  }
  const linkId = `gfont-${key}`;
  if (!document.getElementById(linkId)) {
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }
  document.documentElement.style.setProperty(
    "--kanji-font",
    `"${font.family}", "Klee One", "Shippori Mincho", serif`,
  );
}

function applyTheme(dark) {
  if (dark) {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0E0E0C" : "#EFEBDF";
}

function applyAccent(accentKey, dark) {
  const preset = ACCENT_PRESETS[accentKey]?.[dark ? "dark" : "light"] || ACCENT_PRESETS.vermilion[dark ? "dark" : "light"];
  document.documentElement.style.setProperty("--vermilion", preset.main);
  document.documentElement.style.setProperty("--vermilion-dim", preset.dim);
  document.documentElement.style.setProperty("--vermilion-soft", preset.soft);
}

/* ========================================
   Sync Code (bit array encoding)
   ======================================== */

function encodeSyncCode() {
  const total = state.kanjiData.length;
  const byteCount = Math.ceil(total / 8);
  const bytes = new Uint8Array(byteCount);
  state.kanjiData.forEach((k, i) => {
    if (state.knownSet.has(k.Kanji)) bytes[Math.floor(i / 8)] |= (1 << (i % 8));
  });
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function decodeSyncCode(code) {
  try {
    const binary = atob(code.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const imported = new Set();
    state.kanjiData.forEach((k, i) => {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      if (byteIdx < bytes.length && (bytes[byteIdx] & (1 << bitIdx))) imported.add(k.Kanji);
    });
    return imported;
  } catch {
    return null;
  }
}

/* ========================================
   KanjiVG
   ======================================== */

const KANJIVG_BASE = "https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji";
const kanjiSvgCache = {};

async function fetchKanjiVG(kanji) {
  const code = kanji.codePointAt(0).toString(16).padStart(5, "0");
  if (kanjiSvgCache[code] !== undefined) return kanjiSvgCache[code];
  try {
    const res = await fetch(`${KANJIVG_BASE}/${code}.svg`);
    if (!res.ok) { kanjiSvgCache[code] = null; return null; }
    const text = await res.text();
    kanjiSvgCache[code] = text;
    return text;
  } catch {
    kanjiSvgCache[code] = null;
    return null;
  }
}

function getCachedKanjiVG(kanji) {
  const code = kanji.codePointAt(0).toString(16).padStart(5, "0");
  return kanjiSvgCache[code];
}

function sanitizeKanjiVGSvg(raw) {
  let svg = raw;
  svg = svg.replace(/<\?xml[\s\S]*?\?>/g, "");
  svg = svg.replace(/<!DOCTYPE[\s\S]*?\]\s*>/g, "");
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/g, "");
  svg = svg
    .replace(/style="[^"]*fill:[^"]*#000000[^"]*"/gi, "")
    .replace(/fill="#000000"/gi, "")
    .replace(/fill="#808080"/gi, "");
  svg = svg.replace(/id="kvg:StrokeNumbers_[^"]+"/, (m) => `${m} data-role="stroke-numbers"`);
  svg = svg.replace(/id="kvg:StrokePaths_[^"]+"/, (m) => `${m} data-role="stroke-paths"`);
  return svg.trim();
}

/* ========================================
   Helpers
   ======================================== */

function getCurrentKanji() { return state.kanjiData[state.currentIndex]; }

function getDue() {
  return state.kanjiData.filter(
    (k) => state.knownSet.has(k.Kanji) && isDue(state.srsData[k.Kanji]),
  );
}

function getMeaning(kanji) {
  if (!kanji) return "";
  return JA_GLOSS[kanji.Kanji]
    || kanji.KunReadings?.[0]
    || kanji.OnReadings?.[0]
    || "";
}

function getMeaningLabel(kanji) {
  if (!kanji) return "意";
  if (JA_GLOSS[kanji.Kanji]) return "意";
  if (kanji.KunReadings?.length) return "訓";
  if (kanji.OnReadings?.length) return "音";
  return "—";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function jumpToNextUnknown() {
  // "Newest unlearned" — always jump to the first unknown kanji (edge of progress).
  // Stable: clicking repeatedly stays on the same kanji (no cycling).
  for (let i = 0; i < state.kanjiData.length; i++) {
    const k = state.kanjiData[i];
    if (!state.knownSet.has(k.Kanji) && !state.ignoredSet.has(k.Kanji)) {
      if (i === state.currentIndex) {
        showToast(`既に未習 #${k.Frequency || "—"}`);
        return;
      }
      state.currentIndex = i;
      state.revealed = false;
      saveIndex();
      render();
      showToast(`未習 #${k.Frequency || "—"}`);
      return;
    }
  }
  showToast("全て習得");
}

function jumpToNextIgnored() {
  if (state.ignoredSet.size === 0) { showToast("無視なし"); return; }
  const len = state.kanjiData.length;
  for (let step = 1; step <= len; step++) {
    const i = (state.currentIndex + step) % len;
    if (state.ignoredSet.has(state.kanjiData[i].Kanji)) {
      state.currentIndex = i;
      state.revealed = false;
      saveIndex();
      render();
      showToast(`無視 ${state.kanjiData[i].Kanji}`);
      return;
    }
  }
}

function toggleIgnore() {
  const k = getCurrentKanji();
  if (!k) return;
  if (state.ignoredSet.has(k.Kanji)) {
    state.ignoredSet.delete(k.Kanji);
    saveIgnored();
    showToast(`復活 ${k.Kanji}`);
  } else {
    state.ignoredSet.add(k.Kanji);
    saveIgnored();
    showToast(`無視 ${k.Kanji}`);
    // After ignoring, jump forward so user doesn't linger on an ignored kanji
    nextKanji();
    return;
  }
  render();
}

/* ========================================
   Toast + Confirm
   ======================================== */

function showToast(message) {
  const existing = document.querySelector(".toast-container");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast-container";
  el.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

function showConfirm(title, message, onConfirm) {
  state.confirmDialog = { title, message, onConfirm };
  renderConfirm();
}

function renderConfirm() {
  let el = document.getElementById("confirmOverlay");
  if (!state.confirmDialog) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "confirmOverlay";
    document.body.appendChild(el);
  }
  const { title, message } = state.confirmDialog;
  el.innerHTML = `
    <div class="confirm-dialog" data-stop-propagation>
      <div class="confirm-title">${escapeHtml(title)}</div>
      <div class="confirm-message">${escapeHtml(message)}</div>
      <div class="confirm-actions">
        <button class="confirm-btn confirm-cancel" data-action="confirm-cancel">取消</button>
        <button class="confirm-btn confirm-danger" data-action="confirm-ok">実行</button>
      </div>
    </div>
  `;
  // Dismiss on backdrop click
  el.onclick = (e) => {
    if (e.target === el) {
      state.confirmDialog = null;
      renderConfirm();
    }
  };
}

/* ========================================
   Main Render
   ======================================== */

function render() {
  const app = document.getElementById("app");
  const kanji = getCurrentKanji();
  if (!kanji) return;

  const total = state.kanjiData.length;
  const known = state.knownSet.size;
  const pct = total > 0 ? (known / total) * 100 : 0;
  const dueCount = getDueCount(state.kanjiData, state.knownSet, state.srsData);
  const kanjiHidden =
    (state.mode === "recall" && !state.revealed) ||
    (state.hideKanji && !state.revealed);
  // In recall mode, readings are also hidden (only meaning shown).
  // In hide-kanji mode, readings STAY visible (user recalls kanji from readings).
  const readingsHidden = state.hideReadings && state.mode !== "recall" && !state.revealed;
  const isKnown = state.knownSet.has(kanji.Kanji);
  const srsEntry = state.srsData[kanji.Kanji];

  app.innerHTML = `
    ${renderTopBar(known, total, dueCount)}
    ${renderModeRail(dueCount)}
    <main class="main">
      ${renderHero(kanji, kanjiHidden, isKnown, srsEntry, readingsHidden)}
      ${renderSidePanel(kanji, kanjiHidden, isKnown, srsEntry, readingsHidden)}
    </main>
    ${renderBottomBar(kanji, known, total, pct, kanjiHidden)}
  `;
  // update progress fill
  const fill = app.querySelector(".bottombar-fill");
  if (fill) fill.style.setProperty("--progress", `${pct}%`);
}

function renderTopBar(known, total, dueCount) {
  const idx = state.currentIndex + 1;
  return `
    <header class="topbar">
      <button class="topbar-brand" data-action="jump-unknown" title="次の未習">
        <span class="topbar-brand-kanji">練習</span>
        <span class="topbar-brand-tag">三式</span>
      </button>
      <div class="topbar-center">
        <div class="topbar-idx">
          <span class="topbar-idx-num">${String(idx).padStart(3, "0")}</span>
          <span class="topbar-idx-total">/${total}</span>
        </div>
        <div class="topbar-div"></div>
        <div class="topbar-known">
          <span class="topbar-known-num">${known}</span>
          <span class="topbar-known-label">習得済</span>
        </div>
      </div>
      <div class="topbar-right">
        <button class="iconbtn" data-action="toggle-dark" title="${state.darkMode ? "昼" : "夜"}">${state.darkMode ? "昼" : "夜"}</button>
        <button class="iconbtn" data-action="explorer" title="一覧">一覧</button>
        <button class="iconbtn" data-action="settings" title="設定">設定</button>
      </div>
    </header>
  `;
}

function renderModeRail(dueCount) {
  return `
    <nav class="mode-rail">
      ${MODES.map((m) => {
        const active = state.mode === m.id;
        const badge = m.id === "review" && dueCount > 0
          ? `<span class="mode-btn-badge">${dueCount > 99 ? "99+" : dueCount}</span>`
          : "";
        return `
          <button class="mode-btn ${active ? "active" : ""}" data-action="mode-${m.id}">
            <span class="mode-btn-ja">${m.ja}</span>
            <span class="mode-btn-tag">${m.tag}</span>
            ${badge}
          </button>
        `;
      }).join("")}
    </nav>
  `;
}

function renderHero(kanji, hidden, isKnown, srsEntry) {
  const freqStr = String(kanji.Frequency || 0).padStart(2, "0");
  const srsLabel = srsEntry ? formatInterval(srsEntry) : null;
  const fontLabel = KANJI_FONTS[state.kanjiFont]?.label || "";
  const hasIgnored = state.ignoredSet.size > 0;

  return `
    <div class="hero">
      ${!hidden ? `
        <div class="hero-bg-freq">${freqStr}</div>
        <div class="hero-corner top-right">
          <span class="hero-corner-label">頻度</span>
          <span class="hero-corner-num freq">#${kanji.Frequency || "—"}</span>
        </div>
        ${srsLabel && (state.mode === "review" || state.mode === "recall") ? `
          <div class="hero-srs">
            <span class="hero-srs-label">期</span>
            <span>${escapeHtml(srsLabel)}</span>
          </div>
        ` : ""}
      ` : ""}

      <div class="hero-chips top-left">
        <button class="hero-hide-btn ${state.hideReadings ? "active" : ""}" data-action="toggle-hide" title="${state.hideReadings ? "読み/意味を表示" : "読み/意味を隠す"}">読${state.hideReadings ? "見" : "隠"}</button>
        <button class="hero-hide-btn ${state.hideKanji ? "active" : ""}" data-action="toggle-hide-kanji" title="${state.hideKanji ? "字を表示" : "字を隠す"}">字${state.hideKanji ? "見" : "隠"}</button>
      </div>

      ${hidden ? `
        <div class="hero-recall">
          <span class="hero-recall-label">意</span>
          <div class="hero-recall-prompt">${escapeHtml(getMeaning(kanji) || "—")}</div>
          <button class="hero-reveal-btn" data-action="reveal">表示</button>
        </div>
      ` : `
        <div class="hero-char kanji" data-action="stroke-order" key="${state.currentIndex}">${kanji.Kanji}</div>
      `}

      ${isKnown && !hidden ? `<div class="hero-stamp kanji">習</div>` : ""}
    </div>
  `;
}

function renderSidePanel(kanji, hidden, isKnown, srsEntry, readingsHidden) {
  const lookupSite = LOOKUP_SITES[state.lookUpSite];
  // In review mode, don't show SRS buttons until readings are revealed
  const showSrsButtons =
    (state.mode === "review" && !readingsHidden) ||
    (state.mode === "recall" && state.revealed);
  // In hide-kanji mode, show SRS buttons only after reveal too
  const showSrsButtons2 = showSrsButtons && !(state.hideKanji && !state.revealed && state.mode === "review");
  // Readings stay visible in hide-kanji mode (that's the whole point).
  // They hide only in recall mode (kanji hidden, meaning is the prompt) or hide-readings mode.
  const readingsAreHidden = hidden && state.mode === "recall"; // i.e., recall-hidden only
  const meaningIsHidden = readingsHidden;
  const hideReadingsList = (hidden && state.mode === "recall") || readingsHidden;
  const isIgnored = state.ignoredSet.has(kanji.Kanji);

  return `
    <aside class="side-panel ${readingsHidden ? "hiding" : ""}" ${readingsHidden ? 'data-action="reveal"' : ""}>
      <div class="side-meaning">
        <div class="side-meaning-label">${getMeaningLabel(kanji)}</div>
        <div class="side-meaning-text ${hidden && state.mode === "recall" ? "recall" : ""} ${!getMeaning(kanji) ? "empty" : ""}">
          ${meaningIsHidden ? "？" : escapeHtml(getMeaning(kanji) || "—")}
        </div>
      </div>

      <div class="side-readings">
        ${renderReadingCol("音", "おん", hideReadingsList ? [] : kanji.OnReadings, meaningIsHidden)}
        <div class="reading-col-div"></div>
        ${renderReadingCol("訓", "くん", hideReadingsList ? [] : kanji.KunReadings, meaningIsHidden)}
      </div>

      <div class="side-lookup">
        <button class="side-lookup-link ${isIgnored ? "is-ignored" : ""}" data-action="toggle-ignore" title="${isIgnored ? "無視を解除" : "この漢字を無視"}">
          ${isIgnored ? "復活" : "無視"}
        </button>
        <button class="side-lookup-link" data-action="stroke-external" title="${escapeHtml(STROKE_ORDER_SITES[state.strokeOrderSite]?.label || "")}">
          筆順 ↗
        </button>
        <button class="side-lookup-link" data-action="look-up" title="${escapeHtml(lookupSite?.label || "")}">
          ${escapeHtml(lookupSite?.label || "Look Up")} ↗
        </button>
      </div>

      <div class="side-actions">
        <div class="side-actions-row">
          <button class="pbtn" data-action="prev">
            <span class="pbtn-ja">前</span>
            <span class="pbtn-sub">◁</span>
          </button>
          <button class="pbtn" data-action="next">
            <span class="pbtn-ja">次</span>
            <span class="pbtn-sub">▷</span>
          </button>
        </div>
        ${showSrsButtons ? renderSrsButtons(kanji, srsEntry) : `
          <div class="side-actions-row">
            <button class="pbtn" data-action="stroke-order">
              <span class="pbtn-ja">筆順</span>
              <span class="pbtn-sub">書き方</span>
            </button>
            <button class="pbtn ${isKnown ? "highlight" : "primary"}" data-action="toggle-known">
              <span class="pbtn-ja">${isKnown ? "解除" : "習得"}</span>
              <span class="pbtn-sub">${isKnown ? "取消" : "記憶"}</span>
            </button>
          </div>
        `}
      </div>
    </aside>
  `;
}

function renderReadingCol(label, sub, readings, hidden) {
  const empty = !readings || readings.length === 0;
  const verticalClass = state.verticalReadings ? "vertical" : "";
  return `
    <div class="reading-col">
      <div class="reading-col-head">
        <span class="reading-col-label">${label}</span>
        <span class="reading-col-sub">${sub}</span>
      </div>
      ${hidden ? `<div class="reading-empty">？</div>` : empty ? `<div class="reading-empty">—</div>` : `
        <div class="reading-col-list ${verticalClass}">
          ${readings.map((r) => `<span class="reading-item kanji">${escapeHtml(r)}</span>`).join("")}
        </div>
      `}
    </div>
  `;
}

function renderSrsButtons(kanji, entry) {
  const base = entry || createSrsEntry();
  const p1 = reviewCard(base, 1);
  const p3 = reviewCard(base, 3);
  const p4 = reviewCard(base, 4);
  const p5 = reviewCard(base, 5);
  return `
    <div class="side-actions-row quad">
      <button class="pbtn srs-again" data-action="srs-1">
        <span class="pbtn-ja">再</span>
        <span class="pbtn-sub">${escapeHtml(formatInterval(p1))}</span>
      </button>
      <button class="pbtn srs-hard" data-action="srs-3">
        <span class="pbtn-ja">難</span>
        <span class="pbtn-sub">${escapeHtml(formatInterval(p3))}</span>
      </button>
      <button class="pbtn srs-good" data-action="srs-4">
        <span class="pbtn-ja">良</span>
        <span class="pbtn-sub">${escapeHtml(formatInterval(p4))}</span>
      </button>
      <button class="pbtn srs-easy" data-action="srs-5">
        <span class="pbtn-ja">易</span>
        <span class="pbtn-sub">${escapeHtml(formatInterval(p5))}</span>
      </button>
    </div>
  `;
}

function renderBottomBar(kanji, known, total, pct, hidden) {
  const code = kanji.Kanji.codePointAt(0).toString(16).toUpperCase();
  return `
    <footer class="bottombar">
      <div class="bottombar-pct">${pct.toFixed(1)}%</div>
      <div class="bottombar-progress">
        <div class="bottombar-track">
          <div class="bottombar-fill" style="--progress: ${pct}%"></div>
          ${[10, 20, 30, 40, 50, 60, 70, 80, 90].map((t) =>
            `<div class="bottombar-tick" style="left: ${t}%"></div>`
          ).join("")}
        </div>
        <div class="bottombar-count">${String(known).padStart(3, "0")} / ${String(total).padStart(3, "0")}</div>
      </div>
      <div class="bottombar-current">
        <span class="bottombar-current-label">現在</span>
        <span class="bottombar-current-kanji kanji">${hidden ? "？" : kanji.Kanji}</span>
        <span class="bottombar-current-code">${hidden ? "—" : `U+${code}`}</span>
      </div>
    </footer>
  `;
}

/* ========================================
   Explorer View
   ======================================== */

function renderExplorer() {
  const filter = state.explorerFilter;
  const knownCount = state.knownSet.size;
  const ignoredCount = state.ignoredSet.size;
  const unknownCount = state.kanjiData.length - knownCount - ignoredCount;
  const dueCount = getDueCount(state.kanjiData, state.knownSet, state.srsData);

  const FILTERS = [
    { id: "all", ja: "全", count: state.kanjiData.length },
    { id: "unknown", ja: "未", count: unknownCount },
    { id: "known", ja: "習", count: knownCount },
    { id: "due", ja: "復", count: dueCount },
    { id: "ignored", ja: "無", count: ignoredCount },
  ];

  const arr = computeExplorerCellsArray();
  const gridHtml = arr.length === 0
    ? `<div class="explorer-empty">該当なし</div>`
    : `<div class="explorer-grid">${arr.join("")}</div>`;

  return `
    <div class="view" data-view="explorer">
      <header class="view-head">
        <button class="view-back" data-action="close-view">戻</button>
        <div class="view-title">
          <span class="view-title-ja">一覧</span>
          <span class="view-title-sub">総覧</span>
        </div>
        <div class="view-count">
          <span class="view-count-n">${state.kanjiData.length}</span>
        </div>
      </header>
      <div class="explorer-toolbar">
        <input type="text" id="explorerSearch" class="explorer-search" placeholder="検索 — 漢字・読み・意味" autocomplete="off" value="${escapeHtml(state.explorerQuery)}" />
        <div class="explorer-filters">
          ${FILTERS.map((f) => `
            <button class="explorer-filter ${filter === f.id ? "active" : ""}" data-action="filter-${f.id}">
              <span class="explorer-filter-ja">${f.ja}</span>
              <span class="explorer-filter-count">${f.count}</span>
            </button>
          `).join("")}
        </div>
      </div>
      <div class="view-body">${gridHtml}</div>
    </div>
  `;
}

function computeExplorerCellsArray() {
  const filter = state.explorerFilter;
  const query = state.explorerQuery.trim();
  const arr = [];
  state.kanjiData.forEach((k, idx) => {
    const isKnown = state.knownSet.has(k.Kanji);
    const isItemDue = isKnown && isDue(state.srsData[k.Kanji]);
    const isIgnored = state.ignoredSet.has(k.Kanji);
    if (filter === "ignored" && !isIgnored) return;
    // Other filters exclude ignored kanji from the pool
    if (filter !== "all" && filter !== "ignored" && isIgnored) return;
    if (filter === "known" && !isKnown) return;
    if (filter === "unknown" && isKnown) return;
    if (filter === "due" && !isItemDue) return;
    if (query) {
      if (
        !k.Kanji.includes(query) &&
        !k.OnReadings?.some((r) => r.includes(query)) &&
        !k.KunReadings?.some((r) => r.includes(query)) &&
        !(JA_GLOSS[k.Kanji] || "").includes(query)
      ) return;
    }
    const isCurrent = idx === state.currentIndex;
    let cls = "cell";
    if (isKnown) cls += " known";
    if (isCurrent) cls += " current";
    if (isItemDue) cls += " due";
    if (isIgnored) cls += " ignored";
    arr.push(`<button class="${cls}" data-action="explorer-select" data-index="${idx}" title="${escapeHtml(JA_GLOSS[k.Kanji] || "")}">${k.Kanji}${isKnown && !isCurrent ? '<span class="cell-dot"></span>' : ""}<span class="cell-freq">${k.Frequency || ""}</span></button>`);
  });
  return arr;
}

// Swap only the .view-body contents (the grid) — toolbar stays, search keeps focus.
function swapExplorerGrid(el) {
  const body = el.querySelector(".view-body");
  if (!body) return;
  const arr = computeExplorerCellsArray();
  body.innerHTML = arr.length === 0
    ? `<div class="explorer-empty">該当なし</div>`
    : `<div class="explorer-grid">${arr.join("")}</div>`;
}

function updateExplorerFilterUi(el) {
  const filter = state.explorerFilter;
  const knownCount = state.knownSet.size;
  const ignoredCount = state.ignoredSet.size;
  const unknownCount = state.kanjiData.length - knownCount - ignoredCount;
  const dueCount = getDueCount(state.kanjiData, state.knownSet, state.srsData);
  const counts = { all: state.kanjiData.length, unknown: unknownCount, known: knownCount, due: dueCount, ignored: ignoredCount };
  el.querySelectorAll(".explorer-filter").forEach((btn) => {
    const id = btn.dataset.action.slice("filter-".length);
    btn.classList.toggle("active", id === filter);
    const c = btn.querySelector(".explorer-filter-count");
    if (c) c.textContent = counts[id] ?? "";
  });
}

function scrollExplorerToCurrent(el) {
  const viewBody = el.querySelector(".view-body");
  const current = el.querySelector(".cell.current");
  if (viewBody && current) {
    viewBody.scrollTop = Math.max(0, current.offsetTop - (viewBody.clientHeight - current.clientHeight) / 2);
  }
}

/* ========================================
   Settings View
   ======================================== */

function renderSettingsBody() {
  const total = state.kanjiData.length;
  const known = state.knownSet.size;
  const unknown = total - known;
  const dueCount = getDueCount(state.kanjiData, state.knownSet, state.srsData);
  const pct = total > 0 ? ((known / total) * 100).toFixed(1) : "0.0";

  const stabilityValues = Object.values(state.srsData)
    .filter((e) => e && typeof e.stability === "number" && e.stability > 0)
    .map((e) => e.stability);
  const avgStability = stabilityValues.length > 0
    ? stabilityValues.reduce((a, b) => a + b, 0) / stabilityValues.length
    : null;
  const avgStabilityLabel = avgStability === null
    ? "—"
    : avgStability < 1
      ? `${Math.round(avgStability * 24)}h`
      : avgStability < 30
        ? `${avgStability.toFixed(1)}d`
        : avgStability < 365
          ? `${Math.round(avgStability / 30)}mo`
          : `${(avgStability / 365).toFixed(1)}y`;

  const strokeOptions = Object.entries(STROKE_ORDER_SITES).map(([key, site]) =>
    `<option value="${key}" ${state.strokeOrderSite === key ? "selected" : ""}>${escapeHtml(site.label)}</option>`
  ).join("");

  const lookUpOptions = Object.entries(LOOKUP_SITES).map(([key, site]) =>
    `<option value="${key}" ${state.lookUpSite === key ? "selected" : ""}>${escapeHtml(site.label)}</option>`
  ).join("");

  const fontOptions = Object.entries(KANJI_FONTS).map(([key, font]) =>
    `<option value="${key}" ${state.kanjiFont === key ? "selected" : ""}>${escapeHtml(font.label)}</option>`
  ).join("");

  const fontFam = KANJI_FONTS[state.kanjiFont]?.family
    ? `font-family: &quot;${KANJI_FONTS[state.kanjiFont].family}&quot;, serif;`
    : "";

  return `
    <div class="settings-body">
      <div class="section-head">
        <span class="section-head-ja">進捗</span>
        <span class="section-head-sub">進度</span>
        <span class="section-head-rule"></span>
      </div>
      <div class="stats-grid">
        <div class="big-stat">
          <div class="big-stat-label">習得</div>
          <div class="big-stat-num accent">${known}</div>
        </div>
        <div class="big-stat">
          <div class="big-stat-label">未習</div>
          <div class="big-stat-num">${unknown}</div>
        </div>
        <div class="big-stat">
          <div class="big-stat-label">復習</div>
          <div class="big-stat-num">${dueCount}</div>
        </div>
        <div class="big-stat">
          <div class="big-stat-label">達成</div>
          <div class="big-stat-num">${pct}%</div>
        </div>
      </div>

      <div class="section-head">
        <span class="section-head-ja">外観</span>
        <span class="section-head-sub">見た目</span>
        <span class="section-head-rule"></span>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span class="settings-row-ja">配色</span>
          <span class="settings-row-sub">明暗</span>
        </div>
        <div class="choice">
          <button class="choice-btn ${!state.darkMode ? "active" : ""}" data-action="theme-light">昼</button>
          <button class="choice-btn ${state.darkMode ? "active" : ""}" data-action="theme-dark">夜</button>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span class="settings-row-ja">差色</span>
          <span class="settings-row-sub">色相</span>
        </div>
        <div class="choice">
          ${Object.entries(ACCENTS).map(([k, a]) =>
            `<button class="choice-btn ${state.accent === k ? "active" : ""}" data-action="accent-${k}">${a.ja}</button>`
          ).join("")}
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span class="settings-row-ja">読み方向</span>
          <span class="settings-row-sub">縦横</span>
        </div>
        <div class="choice">
          <button class="choice-btn ${state.verticalReadings ? "active" : ""}" data-action="vertical-on">縦</button>
          <button class="choice-btn ${!state.verticalReadings ? "active" : ""}" data-action="vertical-off">横</button>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span class="settings-row-ja">字体</span>
          <span class="settings-row-sub">フォント</span>
        </div>
        <select class="select" data-action="change-kanji-font">${fontOptions}</select>
      </div>
      <div class="font-preview">
        <span class="font-preview-chars" style="${fontFam}">永遠夢光風</span>
      </div>

      <div class="section-head">
        <span class="section-head-ja">外部</span>
        <span class="section-head-sub">リンク</span>
        <span class="section-head-rule"></span>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span class="settings-row-ja">筆順</span>
          <span class="settings-row-sub">予備</span>
        </div>
        <select class="select" data-action="change-stroke-site">${strokeOptions}</select>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span class="settings-row-ja">辞書</span>
          <span class="settings-row-sub">検索</span>
        </div>
        <select class="select" data-action="change-lookup-site">${lookUpOptions}</select>
      </div>

      <div class="section-head">
        <span class="section-head-ja">同期</span>
        <span class="section-head-sub">Sync</span>
        <span class="section-head-rule"></span>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span class="settings-row-ja">記録送信</span>
          <span class="settings-row-sub">Export</span>
        </div>
        <button class="sync-btn ghost" data-action="export-sync-code">複製</button>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span class="settings-row-ja">記録受信</span>
          <span class="settings-row-sub">Import</span>
        </div>
        <div class="sync-row" style="min-width: 280px;">
          <input type="text" id="syncCodeInput" class="sync-input" placeholder="同期コードを貼付" autocomplete="off" />
          <button class="sync-btn" data-action="import-sync-code">適用</button>
        </div>
      </div>

      <div class="section-head">
        <span class="section-head-ja">データ</span>
        <span class="section-head-sub">Backup</span>
        <span class="section-head-rule"></span>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">
          <span class="settings-row-ja">保存</span>
          <span class="settings-row-sub">JSON</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="sync-btn ghost" data-action="export">出力</button>
          <button class="sync-btn ghost" data-action="import">入力</button>
        </div>
      </div>

      <div class="section-head">
        <span class="section-head-ja">操作</span>
        <span class="section-head-sub">Shortcuts</span>
        <span class="section-head-rule"></span>
      </div>
      <div class="shortcuts-grid">
        ${renderShortcut(["←", "→"], "移動")}
        ${renderShortcut(["空白"], "次へ")}
        ${renderShortcut(["Enter"], "習得")}
        ${renderShortcut(["1","2","3","4"], "復習評価")}
        ${renderShortcut(["S"], "筆順")}
        ${renderShortcut(["E"], "一覧")}
        ${renderShortcut(["R"], "復習")}
        ${renderShortcut(["D"], "昼夜")}
        ${renderShortcut(["U"], "取消")}
        ${renderShortcut(["Esc"], "戻る")}
      </div>

      <div class="section-head">
        <span class="section-head-ja">記録</span>
        <span class="section-head-sub">Reset</span>
        <span class="section-head-rule"></span>
      </div>
      <button class="reset-btn" data-action="reset">
        <span class="reset-btn-ja">初期化</span>
        <span class="reset-btn-sub">全消去</span>
      </button>

      <div class="settings-row" style="margin-top: 24px;">
        <div class="settings-row-label">
          <span class="settings-row-ja">FSRS 平均安定度</span>
          <span class="settings-row-sub">Stability</span>
        </div>
        <span class="big-stat-num" style="font-size: 22px;">${avgStabilityLabel}</span>
      </div>

      <div class="settings-footer">
        <div class="settings-footer-title kanji">練習</div>
        <div class="settings-footer-sub">三式</div>
        <div class="settings-footer-links">
          by <a href="https://github.com/slowpokelu" target="_blank" rel="noopener">slowpokelu</a>
          · <a href="https://ko-fi.com/slowpokelu/tip" target="_blank" rel="noopener">支援</a>
        </div>
      </div>
    </div>
  `;
}

function renderShortcut(keys, ja) {
  return `
    <div class="shortcut-item">
      <div class="shortcut-keys">${keys.map((k) => `<span class="shortcut-key">${escapeHtml(k)}</span>`).join("")}</div>
      <span class="shortcut-ja">${ja}</span>
    </div>
  `;
}

function renderSettings() {
  return `
    <div class="view" data-view="settings">
      <header class="view-head">
        <button class="view-back" data-action="close-view">戻</button>
        <div class="view-title">
          <span class="view-title-ja">設定</span>
          <span class="view-title-sub">環境</span>
        </div>
        <div></div>
      </header>
      <div class="view-body">
        ${renderSettingsBody()}
      </div>
    </div>
  `;
}

/* ========================================
   View Management
   ======================================== */

function renderView() {
  let el = document.getElementById("viewContainer");
  if (!el) {
    el = document.createElement("div");
    el.id = "viewContainer";
    document.body.appendChild(el);
  }

  if (!state.activeView) {
    el.classList.remove("open");
    el.innerHTML = "";
    el.dataset.rendered = "";
    return;
  }

  const isFullRender = el.dataset.rendered !== state.activeView;

  if (isFullRender) {
    el.dataset.rendered = state.activeView;
    if (state.activeView === "explorer") {
      // Full sync render of all 2140 cells. content-visibility: auto on .cell
      // keeps paint cheap (only visible cells get painted).
      el.innerHTML = renderExplorer();
      el.classList.add("open");
      requestAnimationFrame(() => {
        el.querySelector(".view")?.classList.add("entering");
        scrollExplorerToCurrent(el);
      });
    } else {
      if (state.activeView === "settings") el.innerHTML = renderSettings();
      el.classList.add("open");
      requestAnimationFrame(() => {
        el.querySelector(".view")?.classList.add("entering");
      });
    }
    return;
  }

  // Same view already open — minimal update, preserve toolbar/search focus
  if (state.activeView === "explorer") {
    updateExplorerFilterUi(el);
    swapExplorerGrid(el);
  } else if (state.activeView === "settings") {
    const body = el.querySelector(".view-body");
    if (body) body.innerHTML = renderSettingsBody();
  }
}

function openView(name) {
  state.activeView = name;
  if (name === "explorer") {
    state.explorerFilter = "all";
    state.explorerQuery = "";
  }
  renderView();
}

function closeView() {
  const el = document.getElementById("viewContainer");
  const view = el?.querySelector(".view");
  if (view) {
    view.classList.remove("entering");
    view.classList.add("leaving");
    setTimeout(() => {
      state.activeView = null;
      renderView();
    }, 200);
  } else {
    state.activeView = null;
    renderView();
  }
}

/* ========================================
   Stroke Order Modal
   ======================================== */

function renderStrokeOrderShell() {
  const siteLabel = STROKE_ORDER_SITES[state.strokeOrderSite]?.label || "外部";
  return `
    <div class="stroke-dialog" data-stop-propagation>
      <div class="stroke-head">
        <div class="stroke-head-left">
          <span class="stroke-head-title">筆順</span>
          <span class="stroke-head-kanji kanji"></span>
        </div>
        <div class="stroke-head-counter">00 / 00</div>
        <button class="stroke-close-btn" data-action="stroke-close" aria-label="Close">×</button>
      </div>
      <div class="stroke-canvas"></div>
      <div class="stroke-controls">
        <button class="stroke-control-btn primary" data-action="stroke-replay">再生</button>
        <button class="stroke-control-btn ghost" data-action="stroke-numbers">番号</button>
      </div>
      <button class="stroke-external-link" data-action="stroke-external">${escapeHtml(siteLabel)} で開く ↗</button>
    </div>
  `;
}

function renderStrokeOrder() {
  let el = document.getElementById("strokeOverlay");
  if (!state.strokeOrderModal) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "strokeOverlay";
    el.innerHTML = renderStrokeOrderShell();
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.querySelector(".stroke-dialog")?.classList.add("entering");
    });
  }

  const { kanji, svg, loading, error } = state.strokeOrderModal;
  const titleKanji = el.querySelector(".stroke-head-kanji");
  if (titleKanji) titleKanji.textContent = kanji;

  const canvas = el.querySelector(".stroke-canvas");
  if (canvas) {
    canvas.classList.remove("animating", "show-numbers");
    canvas.innerHTML = loading
      ? '<div class="stroke-loading">読込中</div>'
      : error
        ? `<div class="stroke-error"><span class="stroke-error-kanji kanji">${kanji}</span><span class="stroke-error-text">筆順データなし</span></div>`
        : `<div class="stroke-canvas-inner">${sanitizeKanjiVGSvg(svg)}</div>`;
  }

  const replayBtn = el.querySelector('[data-action="stroke-replay"]');
  const numbersBtn = el.querySelector('[data-action="stroke-numbers"]');
  if (replayBtn) replayBtn.disabled = !!(loading || error);
  if (numbersBtn) numbersBtn.disabled = !!(loading || error);
}

function openStrokeOrder() {
  const k = getCurrentKanji();
  if (!k) return;
  showStrokeOrder(k.Kanji);
}

function openStrokeOrderExternal() {
  const k = getCurrentKanji();
  if (!k) return;
  const site = STROKE_ORDER_SITES[state.strokeOrderSite] || STROKE_ORDER_SITES.jisho;
  window.open(site.url(k.Kanji), "_blank");
}

function showStrokeOrder(kanji) {
  const cached = getCachedKanjiVG(kanji);

  if (cached === null) {
    // Known miss — try external fallback
    openStrokeOrderExternal();
    showToast("外部参照");
    return;
  }

  if (cached !== undefined) {
    state.strokeOrderModal = { kanji, svg: cached, loading: false };
    renderStrokeOrder();
    setTimeout(animateStrokeOrder, 240);
    return;
  }

  state.strokeOrderModal = { kanji, loading: true };
  renderStrokeOrder();
  fetchKanjiVG(kanji).then((svg) => {
    if (state.strokeOrderModal?.kanji !== kanji) return;
    if (!svg) {
      state.strokeOrderModal = { kanji, error: true, loading: false };
      renderStrokeOrder();
      return;
    }
    state.strokeOrderModal = { kanji, svg, loading: false };
    renderStrokeOrder();
    setTimeout(animateStrokeOrder, 120);
  });
}

function closeStrokeOrder() {
  cancelPendingStrokeAnim();
  const el = document.getElementById("strokeOverlay");
  const dialog = el?.querySelector(".stroke-dialog");
  if (dialog) {
    dialog.classList.remove("entering");
    dialog.classList.add("leaving");
    el.querySelector(".stroke-canvas")?.classList.remove("animating");
    setTimeout(() => {
      state.strokeOrderModal = null;
      renderStrokeOrder();
    }, 180);
  } else {
    state.strokeOrderModal = null;
    renderStrokeOrder();
  }
}

let strokeTimeouts = [];
let strokeRafId = null;
function cancelPendingStrokeAnim() {
  strokeTimeouts.forEach(clearTimeout);
  strokeTimeouts = [];
  if (strokeRafId != null) {
    cancelAnimationFrame(strokeRafId);
    strokeRafId = null;
  }
}

function animateStrokeOrder() {
  // Cancel any pending timeouts from a previous run so replays don't stack
  cancelPendingStrokeAnim();

  const container = document.querySelector(".stroke-canvas");
  if (!container) return;
  const paths = container.querySelectorAll('g[id*="StrokePaths"] path[d]');
  if (paths.length === 0) return;

  const counter = document.querySelector(".stroke-head-counter");
  const totalStr = String(paths.length).padStart(2, "0");
  if (counter) counter.textContent = `00 / ${totalStr}`;

  // Reset every stroke to hidden synchronously
  paths.forEach((p) => {
    const length = p.getTotalLength();
    p.style.transition = "none";
    p.style.strokeDasharray = length;
    p.style.strokeDashoffset = length;
  });
  void container.offsetWidth;
  container.classList.add("animating");

  strokeRafId = requestAnimationFrame(() => {
    strokeRafId = null;
    const duration = 460;
    const gap = 90;
    let delay = 0;
    paths.forEach((p, i) => {
      const id = setTimeout(() => {
        p.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        p.style.strokeDashoffset = "0";
        if (counter) counter.textContent = `${String(i + 1).padStart(2, "0")} / ${totalStr}`;
      }, delay);
      strokeTimeouts.push(id);
      delay += duration + gap;
    });
  });
}

function toggleStrokeNumbers() {
  const container = document.querySelector(".stroke-canvas");
  if (!container) return;
  container.classList.toggle("show-numbers");
}

/* ========================================
   Business Logic
   ======================================== */

function nextKanji() {
  state.revealed = false;
  if (state.mode === "review") {
    const due = getDue().filter((k) => !state.ignoredSet.has(k.Kanji));
    if (due.length === 0) { showToast("復習なし"); return; }
    const scored = due.map((k) => ({
      kanji: k,
      score: Date.now() - (state.srsData[k.Kanji]?.lastReview || state.srsData[k.Kanji]?.last_review || 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(5, scored.length));
    const pick = top[Math.floor(Math.random() * top.length)];
    state.currentIndex = state.kanjiData.indexOf(pick.kanji);
  } else if (state.mode === "random") {
    const unknown = state.kanjiData
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => !state.knownSet.has(k.Kanji) && !state.ignoredSet.has(k.Kanji));
    if (unknown.length > 0) {
      state.currentIndex = unknown[Math.floor(Math.random() * unknown.length)].i;
    } else {
      showToast("全て習得"); return;
    }
  } else if (state.mode === "recall") {
    const known = state.kanjiData
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => state.knownSet.has(k.Kanji) && !state.ignoredSet.has(k.Kanji));
    if (known.length === 0) { showToast("習得済なし"); return; }
    state.currentIndex = known[Math.floor(Math.random() * known.length)].i;
  } else {
    // Study: advance sequentially, skipping ignored
    const len = state.kanjiData.length;
    for (let step = 1; step <= len; step++) {
      const i = (state.currentIndex + step) % len;
      if (!state.ignoredSet.has(state.kanjiData[i].Kanji)) {
        state.currentIndex = i;
        break;
      }
    }
  }
  saveIndex();
  render();
}

function prevKanji() {
  state.revealed = false;
  const len = state.kanjiData.length;
  // Walk backward, skipping ignored
  for (let step = 1; step <= len; step++) {
    const i = (state.currentIndex - step + len) % len;
    if (!state.ignoredSet.has(state.kanjiData[i].Kanji)) {
      if (i === state.currentIndex) return;
      state.currentIndex = i;
      saveIndex();
      render();
      return;
    }
  }
}

function toggleKnown() {
  const kanji = getCurrentKanji();
  if (state.knownSet.has(kanji.Kanji)) {
    state.knownSet.delete(kanji.Kanji);
    delete state.srsData[kanji.Kanji];
    state.lastAction = null;
    showToast("解除");
  } else {
    state.knownSet.add(kanji.Kanji);
    state.srsData[kanji.Kanji] = createSrsEntry();
    state.lastAction = { type: "mark", kanji: kanji.Kanji };
    showToast("習得");
  }
  saveKnown();
  saveSrs();
  render();
}

function markKnownAndNext() {
  const kanji = getCurrentKanji();
  if (!state.knownSet.has(kanji.Kanji)) {
    state.knownSet.add(kanji.Kanji);
    state.srsData[kanji.Kanji] = createSrsEntry();
    state.lastAction = { type: "mark", kanji: kanji.Kanji };
    saveKnown();
    saveSrs();
  }
  nextKanji();
}

function undoLastAction() {
  if (!state.lastAction) return;
  const { kanji } = state.lastAction;
  state.knownSet.delete(kanji);
  delete state.srsData[kanji];
  state.lastAction = null;
  saveKnown();
  saveSrs();
  showToast("取消");
  render();
}

function rateSrs(quality) {
  const kanji = getCurrentKanji();
  if (!state.knownSet.has(kanji.Kanji)) {
    state.knownSet.add(kanji.Kanji);
    state.srsData[kanji.Kanji] = createSrsEntry();
    saveKnown();
  }
  const entry = state.srsData[kanji.Kanji] || createSrsEntry();
  state.srsData[kanji.Kanji] = reviewCard(entry, quality);
  saveSrs();
  nextKanji();
}

function setMode(mode) {
  state.mode = mode;
  state.revealed = false;
  saveMode();
  if (mode === "review") {
    const due = getDue();
    if (due.length > 0) {
      state.currentIndex = state.kanjiData.indexOf(due[0]);
      saveIndex();
    } else {
      showToast("復習なし");
    }
  } else if (mode === "recall") {
    const known = state.kanjiData.filter((k) => state.knownSet.has(k.Kanji));
    if (known.length > 0) {
      state.currentIndex = state.kanjiData.indexOf(known[Math.floor(Math.random() * known.length)]);
      saveIndex();
    } else {
      showToast("習得済なし");
    }
  }
  render();
}

function setTheme(dark) {
  state.darkMode = dark;
  applyTheme(dark);
  applyAccent(state.accent, dark);
  saveTheme();
  render();
  if (state.activeView) renderView();
}

function setAccent(accent) {
  state.accent = accent;
  applyAccent(accent, state.darkMode);
  saveAccent();
}

function openStrokeOrderFallbackExternal() { openStrokeOrderExternal(); }

function openLookUp() {
  const kanji = getCurrentKanji();
  const site = LOOKUP_SITES[state.lookUpSite] || LOOKUP_SITES.jisho;
  window.open(site.url(kanji.Kanji), "_blank");
}

function exportProgress() {
  const data = {
    version: "3.1",
    known: [...state.knownSet],
    ignored: [...state.ignoredSet],
    srs: state.srsData,
    timestamp: new Date().toISOString(),
    total: state.kanjiData.length,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kanji-v3-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("出力完了");
}

function importProgress() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.known) { state.knownSet = new Set(data.known); saveKnown(); }
        if (data.ignored) { state.ignoredSet = new Set(data.ignored); saveIgnored(); }
        if (data.srs) {
          const { data: migrated } = migrateSrsData(data.srs);
          state.srsData = migrated;
          saveSrs();
        }
        if (data.practiced && !data.known) {
          state.knownSet = new Set(data.practiced);
          saveKnown();
          for (const k of data.practiced) {
            if (!state.srsData[k]) state.srsData[k] = createSrsEntry();
          }
          saveSrs();
        }
        render();
        if (state.activeView) renderView();
        showToast(`${state.knownSet.size} 件入力`);
      } catch {
        showToast("形式無効");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function exportSyncCode() {
  const code = encodeSyncCode();
  navigator.clipboard.writeText(code).then(
    () => showToast(`複製完了 (${state.knownSet.size})`),
    () => prompt("同期コード:", code),
  );
}

function importSyncCode() {
  const input = document.getElementById("syncCodeInput");
  if (!input || !input.value.trim()) { showToast("コード未入力"); return; }
  const imported = decodeSyncCode(input.value);
  if (!imported) { showToast("コード無効"); return; }
  let added = 0;
  for (const k of imported) {
    if (!state.knownSet.has(k)) {
      state.knownSet.add(k);
      if (!state.srsData[k]) state.srsData[k] = createSrsEntry();
      added++;
    }
  }
  saveKnown();
  saveSrs();
  input.value = "";
  render();
  if (state.activeView) renderView();
  showToast(`${added} 件追加`);
}

function resetProgress() {
  showConfirm(
    "初期化",
    "全ての記録を消去します。この操作は取り消せません。",
    () => {
      state.knownSet.clear();
      state.srsData = {};
      state.lastAction = null;
      saveKnown();
      saveSrs();
      render();
      if (state.activeView) renderView();
      showToast("初期化完了");
    },
  );
}

/* ========================================
   Event Delegation
   ======================================== */

document.addEventListener("click", (e) => {
  // Stroke overlay backdrop close
  if (e.target.id === "strokeOverlay") {
    closeStrokeOrder();
    return;
  }

  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case "prev": prevKanji(); break;
    case "next": nextKanji(); break;
    case "toggle-known": {
      const k = getCurrentKanji();
      if (k && state.knownSet.has(k.Kanji)) {
        toggleKnown();      // 解除 — unmark, stay on kanji
      } else {
        markKnownAndNext(); // 習得 — mark and advance
      }
      break;
    }
    case "reveal":
      state.revealed = true;
      render();
      break;
    case "stroke-order": openStrokeOrder(); break;
    case "stroke-close": closeStrokeOrder(); break;
    case "stroke-replay": animateStrokeOrder(); break;
    case "stroke-numbers": toggleStrokeNumbers(); break;
    case "stroke-external":
      closeStrokeOrder();
      openStrokeOrderExternal();
      break;
    case "look-up": openLookUp(); break;
    case "jump-unknown": jumpToNextUnknown(); break;
    case "cycle-font": {
      const idx = FONT_KEYS.indexOf(state.kanjiFont);
      const nextIdx = (idx + 1) % FONT_KEYS.length;
      state.kanjiFont = FONT_KEYS[nextIdx];
      applyKanjiFont(state.kanjiFont);
      saveFont();
      showToast(KANJI_FONTS[state.kanjiFont].label);
      const btn = document.querySelector(".font-cycle-btn");
      if (btn) btn.title = KANJI_FONTS[state.kanjiFont].label;
      break;
    }
    case "toggle-dark": setTheme(!state.darkMode); break;
    case "toggle-hide":
      state.hideReadings = !state.hideReadings;
      if (state.hideReadings) state.hideKanji = false;
      state.revealed = false;
      saveHideReadings();
      saveHideKanji();
      render();
      break;
    case "toggle-hide-kanji":
      state.hideKanji = !state.hideKanji;
      if (state.hideKanji) state.hideReadings = false;
      state.revealed = false;
      saveHideReadings();
      saveHideKanji();
      render();
      break;
    case "toggle-ignore":
      toggleIgnore();
      break;
    case "jump-ignored": jumpToNextIgnored(); break;
    case "theme-light": setTheme(false); break;
    case "theme-dark": setTheme(true); break;
    case "vertical-on":
      state.verticalReadings = true; saveVertical(); render();
      if (state.activeView) renderView();
      break;
    case "vertical-off":
      state.verticalReadings = false; saveVertical(); render();
      if (state.activeView) renderView();
      break;
    case "explorer": openView("explorer"); break;
    case "settings": openView("settings"); break;
    case "close-view": closeView(); break;
    case "explorer-select": {
      const idx = parseInt(target.dataset.index, 10);
      state.currentIndex = idx;
      state.revealed = false;
      saveIndex();
      render();
      closeView();
      break;
    }
    case "filter-all": state.explorerFilter = "all"; renderView(); break;
    case "filter-known": state.explorerFilter = "known"; renderView(); break;
    case "filter-unknown": state.explorerFilter = "unknown"; renderView(); break;
    case "filter-due": state.explorerFilter = "due"; renderView(); break;
    case "filter-ignored": state.explorerFilter = "ignored"; renderView(); break;
    case "export": exportProgress(); break;
    case "import": importProgress(); break;
    case "export-sync-code": exportSyncCode(); break;
    case "import-sync-code": importSyncCode(); break;
    case "reset": resetProgress(); break;
    case "confirm-cancel":
      state.confirmDialog = null;
      renderConfirm();
      break;
    case "confirm-ok":
      if (state.confirmDialog?.onConfirm) state.confirmDialog.onConfirm();
      state.confirmDialog = null;
      renderConfirm();
      break;

    case "mode-study": setMode("study"); break;
    case "mode-random": setMode("random"); break;
    case "mode-recall": setMode("recall"); break;
    case "mode-review": setMode("review"); break;

    case "srs-1": rateSrs(1); break;
    case "srs-3": rateSrs(3); break;
    case "srs-4": rateSrs(4); break;
    case "srs-5": rateSrs(5); break;

    default:
      // accent-*
      if (action.startsWith("accent-")) {
        const key = action.slice(7);
        if (ACCENTS[key]) { setAccent(key); render(); if (state.activeView) renderView(); }
      }
  }
});

document.addEventListener("change", (e) => {
  const action = e.target.dataset?.action;
  if (action === "change-stroke-site") {
    state.strokeOrderSite = e.target.value;
    saveSitePrefs();
  } else if (action === "change-lookup-site") {
    state.lookUpSite = e.target.value;
    saveSitePrefs();
    render(); // update lookup link text
  } else if (action === "change-kanji-font") {
    state.kanjiFont = e.target.value;
    applyKanjiFont(e.target.value);
    saveFont();
    const preview = document.querySelector(".font-preview-chars");
    if (preview) {
      const font = KANJI_FONTS[e.target.value];
      preview.style.fontFamily = font?.family ? `"${font.family}", serif` : "";
    }
  }
});

let searchDebounceId = null;
document.addEventListener("input", (e) => {
  if (e.target.id === "explorerSearch") {
    state.explorerQuery = e.target.value;
    clearTimeout(searchDebounceId);
    searchDebounceId = setTimeout(() => renderView(), 80);
  }
});

/* ========================================
   Keyboard Shortcuts
   ======================================== */

document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (state.strokeOrderModal) {
    if (e.key === "Escape") closeStrokeOrder();
    return;
  }
  if (state.activeView) {
    if (e.key === "Escape") closeView();
    return;
  }
  if (state.confirmDialog) {
    if (e.key === "Escape") {
      state.confirmDialog = null;
      renderConfirm();
    }
    return;
  }

  switch (e.key) {
    case "ArrowLeft": e.preventDefault(); prevKanji(); break;
    case "ArrowRight":
    case " ":
      e.preventDefault();
      if (!state.revealed && (state.mode === "recall" || state.hideReadings)) {
        state.revealed = true;
        render();
      } else {
        nextKanji();
      }
      break;
    case "Enter": e.preventDefault(); markKnownAndNext(); break;
    case "d": case "D": e.preventDefault(); setTheme(!state.darkMode); break;
    case "e": case "E":
      e.preventDefault();
      if (state.activeView === "explorer") closeView();
      else openView("explorer");
      break;
    case "s": case "S": e.preventDefault(); openStrokeOrder(); break;
    case "u": case "U": e.preventDefault(); undoLastAction(); break;
    case "1":
      e.preventDefault();
      if (state.mode === "review" || (state.mode === "recall" && state.revealed)) rateSrs(1);
      break;
    case "2":
      e.preventDefault();
      if (state.mode === "review" || (state.mode === "recall" && state.revealed)) rateSrs(3);
      break;
    case "3":
      e.preventDefault();
      if (state.mode === "review" || (state.mode === "recall" && state.revealed)) rateSrs(4);
      break;
    case "4":
      e.preventDefault();
      if (state.mode === "review" || (state.mode === "recall" && state.revealed)) rateSrs(5);
      break;
    case "r": case "R":
      e.preventDefault();
      if (e.shiftKey) setMode("recall");
      else setMode("review");
      break;
  }
});

/* ========================================
   Init
   ======================================== */

async function init() {
  await loadKanjiData();
  loadState();

  if (state.kanjiData.length === 0) {
    document.getElementById("app").innerHTML = `
      <div class="loading" style="color: var(--vermilion)">
        <p>データ読込失敗</p>
        <p style="font-size: 12px; letter-spacing: 2px; opacity: 0.7">再読込してください</p>
      </div>
    `;
    return;
  }

  if (state.currentIndex >= state.kanjiData.length) state.currentIndex = 0;
  render();
}

init();
