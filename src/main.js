import "./style.css";
import { createSrsEntry, reviewCard, isDue, getDueCount, formatInterval } from "./srs.js";

/* ========================================
   State
   ======================================== */

const state = {
  kanjiData: [],
  currentIndex: 0,
  knownSet: new Set(),
  mode: "study", // study | random | review | recall
  hideKanji: false,
  darkMode: false,
  activeView: null, // null | "explorer" | "settings"
  explorerFilter: "all",
  srsData: {},
  recallRevealed: false,
  lastAction: null,
  confirmDialog: null,
  strokeOrderSite: "kanjialive",
  lookUpSite: "jisho",
  kanjiFont: "system",
};

/* ========================================
   External Link Config
   ======================================== */

const STROKE_ORDER_SITES = {
  kanjialive: { label: "Kanji Alive", url: (k) => `https://app.kanjialive.com/${encodeURIComponent(k)}` },
  jisho: { label: "Jisho", url: (k) => `https://jisho.org/search/${k}%20%23kanji` },
  strokeorder: { label: "Stroke Order Navi", url: (k) => `https://kanji-stroke-order.com/kanji/u${k.codePointAt(0).toString(16)}` },
};

const LOOKUP_SITES = {
  jisho: { label: "Jisho", url: (k) => `https://jisho.org/search/${k}%20%23kanji` },
  wanikani: { label: "WaniKani", url: (k) => `https://www.wanikani.com/kanji/${encodeURIComponent(k)}` },
  kanshudo: { label: "Kanshudo", url: (k) => `https://www.kanshudo.com/kanji/${encodeURIComponent(k)}` },
  kanjimap: { label: "The Kanji Map", url: (k) => `https://thekanjimap.com/${encodeURIComponent(k)}` },
  mojinavi: { label: "Mojinavi", url: (k) => `https://mojinavi.com/d/u${k.codePointAt(0).toString(16)}` },
};

const KANJI_FONTS = {
  system: { label: "System Default", family: null },
  notosans: { label: "Noto Sans JP", family: "Noto Sans JP" },
  notoserif: { label: "Noto Serif JP", family: "Noto Serif JP" },
  zenmarugothic: { label: "Zen Maru Gothic", family: "Zen Maru Gothic" },
  shippori: { label: "Shippori Mincho", family: "Shippori Mincho" },
  kleeone: { label: "Klee One", family: "Klee One" },
  yomogi: { label: "Yomogi", family: "Yomogi" },
  yuseimagic: { label: "Yusei Magic", family: "Yusei Magic" },
  hinamincho: { label: "Hina Mincho", family: "Hina Mincho" },
  kaiseidecol: { label: "Kaisei Decol", family: "Kaisei Decol" },
  dotgothic: { label: "DotGothic16", family: "DotGothic16" },
  reggaeone: { label: "Reggae One", family: "Reggae One" },
};
const FONT_KEYS = Object.keys(KANJI_FONTS);

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

    const srs = localStorage.getItem("nk3_srs");
    if (srs) state.srsData = JSON.parse(srs);

    const theme = localStorage.getItem("nk3_theme");
    if (theme === "dark") {
      state.darkMode = true;
      document.documentElement.setAttribute("data-theme", "dark");
    }

    const idx = localStorage.getItem("nk3_index");
    if (idx) state.currentIndex = parseInt(idx, 10) || 0;

    const strokeSite = localStorage.getItem("nk3_strokeOrderSite");
    if (strokeSite && STROKE_ORDER_SITES[strokeSite]) state.strokeOrderSite = strokeSite;

    const lookUpSite = localStorage.getItem("nk3_lookUpSite");
    if (lookUpSite && LOOKUP_SITES[lookUpSite]) state.lookUpSite = lookUpSite;

    const kanjiFont = localStorage.getItem("nk3_kanjiFont");
    if (kanjiFont && KANJI_FONTS[kanjiFont]) {
      state.kanjiFont = kanjiFont;
      applyKanjiFont(kanjiFont);
    }
  } catch {
    // ignore corrupt data
  }
}

function saveKnown() {
  localStorage.setItem("nk3_known", JSON.stringify([...state.knownSet]));
}

function saveSrs() {
  localStorage.setItem("nk3_srs", JSON.stringify(state.srsData));
}

function saveTheme() {
  localStorage.setItem("nk3_theme", state.darkMode ? "dark" : "light");
}

function saveIndex() {
  localStorage.setItem("nk3_index", String(state.currentIndex));
}

function saveSitePrefs() {
  localStorage.setItem("nk3_strokeOrderSite", state.strokeOrderSite);
  localStorage.setItem("nk3_lookUpSite", state.lookUpSite);
}

function saveFont() {
  localStorage.setItem("nk3_kanjiFont", state.kanjiFont);
}

function applyKanjiFont(key) {
  const font = KANJI_FONTS[key];
  if (!font || !font.family) {
    document.documentElement.style.removeProperty("--kanji-font");
    return;
  }
  // Load from Google Fonts if not already loaded
  const linkId = `gfont-${key}`;
  if (!document.getElementById(linkId)) {
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }
  document.documentElement.style.setProperty("--kanji-font", `"${font.family}"`);
}

/* ========================================
   Sync Code (bit array encoding)
   ======================================== */

function encodeSyncCode() {
  const total = state.kanjiData.length;
  const byteCount = Math.ceil(total / 8);
  const bytes = new Uint8Array(byteCount);

  state.kanjiData.forEach((k, i) => {
    if (state.knownSet.has(k.Kanji)) {
      bytes[Math.floor(i / 8)] |= (1 << (i % 8));
    }
  });

  // Convert to base64
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function decodeSyncCode(code) {
  try {
    const binary = atob(code.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const imported = new Set();
    state.kanjiData.forEach((k, i) => {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      if (byteIdx < bytes.length && (bytes[byteIdx] & (1 << bitIdx))) {
        imported.add(k.Kanji);
      }
    });
    return imported;
  } catch {
    return null;
  }
}

/* ========================================
   Helpers
   ======================================== */

function getCurrentKanji() {
  return state.kanjiData[state.currentIndex];
}

function getDue() {
  return state.kanjiData.filter(
    (k) => state.knownSet.has(k.Kanji) && isDue(state.srsData[k.Kanji]),
  );
}

function jumpToNextUnknown() {
  const len = state.kanjiData.length;
  for (let i = 0; i < len; i++) {
    if (!state.knownSet.has(state.kanjiData[i].Kanji)) {
      state.currentIndex = i;
      state.recallRevealed = false;
      saveIndex();
      render();
      const k = state.kanjiData[i];
      showToast(`#${k.Frequency > 0 ? k.Frequency : "—"} ${k.Kanji}`);
      return;
    }
  }
  showToast("All kanji are known!");
}

function toggleDropdown(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const wasOpen = el.classList.contains("open");
  closeAllDropdowns();
  if (!wasOpen) el.classList.add("open");
}

function closeAllDropdowns() {
  document.querySelectorAll(".split-dropdown.open").forEach((d) => d.classList.remove("open"));
}

function showToast(message) {
  const existing = document.querySelector(".toast-container");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = "toast-container";
  el.innerHTML = `<div class="toast">${message}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
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
    <div class="confirm-overlay" data-action="confirm-cancel">
      <div class="confirm-dialog" data-stop-propagation>
        <div class="confirm-title">${title}</div>
        <div class="confirm-message">${message}</div>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-cancel" data-action="confirm-cancel">Cancel</button>
          <button class="confirm-btn confirm-danger" data-action="confirm-ok">Confirm</button>
        </div>
      </div>
    </div>
  `;
}

/* ========================================
   Rendering - Main Study View
   ======================================== */

function render() {
  const app = document.getElementById("app");
  const kanji = getCurrentKanji();
  if (!kanji) return;

  const isKnown = state.knownSet.has(kanji.Kanji);
  const progress = state.knownSet.size;
  const total = state.kanjiData.length;
  const pct = total > 0 ? ((progress / total) * 100).toFixed(1) : "0.0";
  const dueCount = getDueCount(state.kanjiData, state.knownSet, state.srsData);

  const shouldHide = state.hideKanji || (state.mode === "recall" && !state.recallRevealed);
  const kanjiDisplay = shouldHide ? "?" : kanji.Kanji;
  const charClass = shouldHide ? "kanji-char hidden" : "kanji-char";

  const srsEntry = state.srsData[kanji.Kanji];
  const srsInfo = srsEntry ? formatInterval(srsEntry) : null;

  const showSrsButtons =
    (state.mode === "review") ||
    (state.mode === "recall" && state.recallRevealed);

  app.innerHTML = `
    ${renderHeader(progress, total, pct)}
    <div class="progress-track"><div class="progress-fill" style="width: ${pct}%"></div></div>

    <div class="kanji-display" key="${state.currentIndex}">
      <div class="${charClass}">${kanjiDisplay}</div>
      <div class="kanji-sub-row">
        <div class="known-indicator${isKnown ? "" : " hidden"}">Known</div>
        <button class="font-cycle-btn" data-action="cycle-font" title="${KANJI_FONTS[state.kanjiFont].label}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><text x="3" y="17" font-size="14" font-weight="bold" fill="currentColor" stroke="none">A</text><text x="14" y="17" font-size="10" fill="currentColor" stroke="none">a</text></svg>
        </button>
      </div>
    </div>

    <div class="readings-area">
      ${renderReadings(kanji)}
    </div>

    <div class="meta-row">
      <span>${kanji.Frequency > 0 ? `#${kanji.Frequency}` : "Rare"}</span>
      ${srsInfo ? `<span class="srs-pill">${srsInfo}</span>` : ""}
      <span>${state.currentIndex + 1} / ${total}</span>
    </div>

    ${renderNav()}
    ${renderActions(isKnown, showSrsButtons)}
  `;

  // Render bottom tab bar (outside #app, fixed position)
  renderTabBar();
}

function renderHeader(progress, total, pct) {
  return `
    <header class="header">
      <button class="header-title" data-action="jump-unknown" title="Jump to next unknown">
        漢字書く練習
        <span class="header-count">${progress}<span class="dim">/${total}</span> <span class="header-pct">${pct}%</span></span>
      </button>
      <div class="header-right">
        <button class="header-btn" data-action="toggle-dark" title="Toggle dark mode">
          ${state.darkMode
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
          }
        </button>
        <button class="header-btn" data-action="explorer" title="Explorer">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        </button>
        <button class="header-btn" data-action="settings" title="Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </header>
  `;
}

function renderReadings(kanji) {
  const on = kanji.OnReadings?.length
    ? `<div class="reading"><span class="reading-label">音</span><span>${kanji.OnReadings.join("、")}</span></div>`
    : `<div class="reading placeholder"><span class="reading-label">音</span><span>—</span></div>`;
  const kun = kanji.KunReadings?.length
    ? `<div class="reading"><span class="reading-label">訓</span><span>${kanji.KunReadings.join("、")}</span></div>`
    : `<div class="reading placeholder"><span class="reading-label">訓</span><span>—</span></div>`;
  return `<div class="readings">${on}${kun}</div>`;
}

function renderTabBar() {
  let el = document.getElementById("tabBar");
  if (!el) {
    el = document.createElement("nav");
    el.id = "tabBar";
    el.className = "tab-bar";
    document.body.appendChild(el);
  }

  const modes = [
    { id: "study", label: "Study", icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' },
    { id: "random", label: "Random", icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>' },
    { id: "review", label: "Review", icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
    { id: "recall", label: "Recall", icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' },
  ];

  const dueCount = getDueCount(state.kanjiData, state.knownSet, state.srsData);

  el.innerHTML = modes.map((m) =>
    `<button class="tab ${state.mode === m.id ? "active" : ""}" data-action="mode-${m.id}">
      ${m.id === "review" && dueCount > 0 ? `<span class="tab-badge">${dueCount > 99 ? "99+" : dueCount}</span>` : ""}
      ${m.icon}
      <span>${m.label}</span>
    </button>`
  ).join("");
}

function renderNav() {
  return `
    <div class="row">
      <button class="btn secondary" data-action="prev">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        Prev
      </button>
      <button class="btn secondary" data-action="next">
        Next
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>
  `;
}

function renderActions(isKnown, showSrsButtons) {
  if (state.mode === "recall" && !state.recallRevealed) {
    return `
      <div class="row single">
        <button class="btn primary" data-action="reveal">Reveal Kanji</button>
      </div>
    `;
  }

  if (showSrsButtons) {
    const kanji = getCurrentKanji();
    const entry = state.srsData[kanji.Kanji] || createSrsEntry();
    const previewAgain = reviewCard(entry, 1);
    const previewHard = reviewCard(entry, 3);
    const previewGood = reviewCard(entry, 4);
    const previewEasy = reviewCard(entry, 5);

    return `
      <div class="srs-row">
        <button class="srs-btn again" data-action="srs-1">
          <span>Again</span>
          <span class="srs-time">${formatInterval(previewAgain)}</span>
        </button>
        <button class="srs-btn hard" data-action="srs-3">
          <span>Hard</span>
          <span class="srs-time">${formatInterval(previewHard)}</span>
        </button>
        <button class="srs-btn good" data-action="srs-4">
          <span>Good</span>
          <span class="srs-time">${formatInterval(previewGood)}</span>
        </button>
        <button class="srs-btn easy" data-action="srs-5">
          <span>Easy</span>
          <span class="srs-time">${formatInterval(previewEasy)}</span>
        </button>
      </div>
      ${renderLinkButtons(isKnown)}
    `;
  }

  const undoHtml = state.lastAction
    ? `<div class="row single"><button class="btn text" data-action="undo">Undo</button></div>`
    : "";

  return `
    ${renderLinkButtons(isKnown)}
    ${undoHtml}
  `;
}

function renderLinkButtons(isKnown) {
  const strokeSites = Object.entries(STROKE_ORDER_SITES).map(([key, site]) =>
    `<button class="dropdown-item ${state.strokeOrderSite === key ? "active" : ""}" data-action="quick-stroke" data-site="${key}">${site.label}</button>`
  ).join("");
  const lookUpSites = Object.entries(LOOKUP_SITES).map(([key, site]) =>
    `<button class="dropdown-item ${state.lookUpSite === key ? "active" : ""}" data-action="quick-lookup" data-site="${key}">${site.label}</button>`
  ).join("");

  return `
    <div class="row">
      <div class="split-btn">
        <button class="btn secondary split-main" data-action="stroke-order">Stroke Order</button>
        <button class="btn secondary split-arrow" data-action="toggle-stroke-dropdown">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="split-dropdown" id="strokeDropdown">${strokeSites}</div>
      </div>
      <div class="split-btn">
        <button class="btn secondary split-main" data-action="look-up">Look Up</button>
        <button class="btn secondary split-arrow" data-action="toggle-lookup-dropdown">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="split-dropdown" id="lookupDropdown">${lookUpSites}</div>
      </div>
    </div>
    <div class="row single">
      <button class="btn ${isKnown ? "known" : "primary"}" data-action="toggle-known">
        ${isKnown ? "Known ✓" : "Mark Known"}
      </button>
    </div>
  `;
}

/* ========================================
   Rendering - Explorer View
   ======================================== */

function renderExplorer() {
  const filtered = state.kanjiData.filter((k) => {
    if (state.explorerFilter === "known") return state.knownSet.has(k.Kanji);
    if (state.explorerFilter === "unknown") return !state.knownSet.has(k.Kanji);
    if (state.explorerFilter === "due")
      return state.knownSet.has(k.Kanji) && isDue(state.srsData[k.Kanji]);
    return true;
  });

  const knownCount = state.knownSet.size;
  const unknownCount = state.kanjiData.length - knownCount;
  const dueCount = getDueCount(state.kanjiData, state.knownSet, state.srsData);

  const grid = filtered.length > 0
    ? filtered.map((k) => {
        const idx = state.kanjiData.indexOf(k);
        const isKnown = state.knownSet.has(k.Kanji);
        const isCurrent = idx === state.currentIndex;
        const isItemDue = isKnown && isDue(state.srsData[k.Kanji]);
        let cls = "cell";
        if (isKnown) cls += " known";
        if (isCurrent) cls += " current";
        if (isItemDue) cls += " due";
        return `<div class="${cls}" data-action="explorer-select" data-index="${idx}">${k.Kanji}</div>`;
      }).join("")
    : `<div class="empty-state">No kanji match this filter</div>`;

  return `
    <div class="view" data-view="explorer">
      <div class="view-nav">
        <button class="back-btn" data-action="close-view">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          Back
        </button>
        <span class="view-title">Explorer</span>
        <span class="view-title-spacer"></span>
      </div>
      <div class="view-body">
        <div class="search-box">
          <input type="text" id="explorerSearch" class="search-input"
            placeholder="Type a kanji to jump..." maxlength="1" autocomplete="off" />
        </div>
        <div class="chip-row">
          <button class="chip ${state.explorerFilter === "all" ? "active" : ""}" data-action="filter-all">All (${state.kanjiData.length})</button>
          <button class="chip ${state.explorerFilter === "unknown" ? "active" : ""}" data-action="filter-unknown">Unknown (${unknownCount})</button>
          <button class="chip ${state.explorerFilter === "known" ? "active" : ""}" data-action="filter-known">Known (${knownCount})</button>
          <button class="chip ${state.explorerFilter === "due" ? "active" : ""}" data-action="filter-due">Due (${dueCount})</button>
        </div>
        <div class="kanji-grid">${grid}</div>
      </div>
    </div>
  `;
}

/* ========================================
   Rendering - Settings View
   ======================================== */

function renderSettings() {
  const total = state.kanjiData.length;
  const known = state.knownSet.size;
  const unknown = total - known;
  const dueCount = getDueCount(state.kanjiData, state.knownSet, state.srsData);
  const pct = total > 0 ? ((known / total) * 100).toFixed(1) : "0.0";

  const easeValues = Object.values(state.srsData).map((e) => e.easeFactor);
  const avgEase = easeValues.length > 0
    ? (easeValues.reduce((a, b) => a + b, 0) / easeValues.length).toFixed(2)
    : "—";

  // Build site option HTML
  const strokeOptions = Object.entries(STROKE_ORDER_SITES).map(([key, site]) =>
    `<option value="${key}" ${state.strokeOrderSite === key ? "selected" : ""}>${site.label}</option>`
  ).join("");

  const lookUpOptions = Object.entries(LOOKUP_SITES).map(([key, site]) =>
    `<option value="${key}" ${state.lookUpSite === key ? "selected" : ""}>${site.label}</option>`
  ).join("");

  const fontOptions = Object.entries(KANJI_FONTS).map(([key, font]) =>
    `<option value="${key}" ${state.kanjiFont === key ? "selected" : ""}>${font.label}</option>`
  ).join("");

  return `
    <div class="view" data-view="settings">
      <div class="view-nav">
        <button class="back-btn" data-action="close-view">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          Back
        </button>
        <span class="view-title">Settings</span>
        <span class="view-title-spacer"></span>
      </div>
      <div class="view-body">

        <div class="section-label">Statistics</div>
        <div class="group">
          <div class="stats">
            <div class="stat">
              <div class="stat-num accent">${known}</div>
              <div class="stat-desc">Known (${pct}%)</div>
            </div>
            <div class="stat">
              <div class="stat-num">${unknown}</div>
              <div class="stat-desc">Unknown</div>
            </div>
            <div class="stat">
              <div class="stat-num warning">${dueCount}</div>
              <div class="stat-desc">Due</div>
            </div>
            <div class="stat">
              <div class="stat-num">${avgEase}</div>
              <div class="stat-desc">Avg. Ease</div>
            </div>
          </div>
        </div>

        <div class="section-label">Appearance</div>
        <div class="group">
          <div class="group-row">
            <span class="group-row-label">Kanji Font</span>
            <select class="group-select" data-action="change-kanji-font">${fontOptions}</select>
          </div>
          <div class="font-preview" style="${state.kanjiFont !== "system" && KANJI_FONTS[state.kanjiFont]?.family ? `font-family: &quot;${KANJI_FONTS[state.kanjiFont].family}&quot;` : ""}">
            <span class="font-preview-chars">永遠夢光風</span>
          </div>
        </div>

        <div class="section-label">External Links</div>
        <div class="group">
          <div class="group-row">
            <span class="group-row-label">Stroke Order</span>
            <select class="group-select" data-action="change-stroke-site">${strokeOptions}</select>
          </div>
          <div class="group-row">
            <span class="group-row-label">Look Up</span>
            <select class="group-select" data-action="change-lookup-site">${lookUpOptions}</select>
          </div>
        </div>

        <div class="section-label">Sync</div>
        <div class="group">
          <button class="group-row clickable" data-action="export-sync-code">
            <span class="group-row-label">Export Sync Code</span>
            <span class="group-row-hint">Copy to clipboard</span>
          </button>
          <div class="group-row column" id="syncImportRow">
            <div class="group-row-top">
              <span class="group-row-label">Import Sync Code</span>
            </div>
            <div class="sync-input-row">
              <input type="text" id="syncCodeInput" class="sync-input" placeholder="Paste sync code..." autocomplete="off" />
              <button class="sync-apply-btn" data-action="import-sync-code">Apply</button>
            </div>
          </div>
        </div>

        <div class="section-label">Data</div>
        <div class="group">
          <button class="group-row clickable" data-action="export">
            <span class="group-row-label">Export JSON</span>
            <span class="group-row-hint">Download backup file</span>
          </button>
          <button class="group-row clickable" data-action="import">
            <span class="group-row-label">Import JSON</span>
            <span class="group-row-hint">Restore from backup</span>
          </button>
          <button class="group-row clickable danger" data-action="reset">
            <span class="group-row-label">Reset All Progress</span>
          </button>
        </div>

        <div class="section-label">Settings Sync</div>
        <div class="group">
          <button class="group-row clickable" data-action="export-settings">
            <span class="group-row-label">Export Settings</span>
            <span class="group-row-hint">Copy to clipboard</span>
          </button>
          <div class="group-row column">
            <div class="group-row-top">
              <span class="group-row-label">Import Settings</span>
            </div>
            <div class="sync-input-row">
              <input type="text" id="settingsCodeInput" class="sync-input" placeholder="Paste settings code..." autocomplete="off" />
              <button class="sync-apply-btn" data-action="import-settings">Apply</button>
            </div>
          </div>
        </div>

        <div class="section-label">Keyboard Shortcuts</div>
        <div class="group">
          <div class="shortcuts-list">
            <div class="shortcut"><kbd>←</kbd><kbd>→</kbd><span>Navigate</span></div>
            <div class="shortcut"><kbd>Space</kbd><span>Next kanji</span></div>
            <div class="shortcut"><kbd>Enter</kbd><span>Mark known + next</span></div>
            <div class="shortcut"><kbd>H</kbd><span>Hide/show kanji</span></div>
            <div class="shortcut"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><span>Rate (SRS)</span></div>
            <div class="shortcut"><kbd>E</kbd><span>Explorer</span></div>
            <div class="shortcut"><kbd>S</kbd><span>Stroke order</span></div>
            <div class="shortcut"><kbd>D</kbd><span>Dark mode</span></div>
            <div class="shortcut"><kbd>R</kbd><span>Review mode</span></div>
            <div class="shortcut"><kbd>U</kbd><span>Undo</span></div>
            <div class="shortcut"><kbd>Esc</kbd><span>Go back</span></div>
          </div>
        </div>

        <div class="settings-footer">
          <div class="settings-footer-title">漢字書く練習</div>
          <div class="settings-footer-links">
            made by <a href="https://github.com/slowpokelu" target="_blank" rel="noopener">slowpokelu</a>
            ·
            <a href="https://ko-fi.com/slowpokelu/tip" target="_blank" rel="noopener">support me ♡</a>
          </div>
        </div>
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

  if (state.activeView === "explorer") {
    el.innerHTML = renderExplorer();
    el.classList.add("open");
    requestAnimationFrame(() => {
      el.querySelector(".view")?.classList.add("entering");
    });
  } else if (state.activeView === "settings") {
    el.innerHTML = renderSettings();
    el.classList.add("open");
    requestAnimationFrame(() => {
      el.querySelector(".view")?.classList.add("entering");
    });
  } else {
    el.classList.remove("open");
    el.innerHTML = "";
  }
}

function openView(name) {
  state.activeView = name;
  if (name === "explorer") state.explorerFilter = "all";
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
    }, 250);
  } else {
    state.activeView = null;
    renderView();
  }
}

/* ========================================
   Business Logic
   ======================================== */

function nextKanji() {
  state.recallRevealed = false;

  if (state.mode === "review") {
    const due = getDue();
    if (due.length === 0) {
      showToast("All caught up! No reviews due.");
      return;
    }
    const scored = due.map((k) => ({
      kanji: k,
      score: Date.now() - (state.srsData[k.Kanji]?.lastReview || 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(5, scored.length));
    const pick = top[Math.floor(Math.random() * top.length)];
    state.currentIndex = state.kanjiData.indexOf(pick.kanji);
  } else if (state.mode === "random") {
    const unknown = state.kanjiData
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => !state.knownSet.has(k.Kanji));
    if (unknown.length > 0) {
      const pick = unknown[Math.floor(Math.random() * unknown.length)];
      state.currentIndex = pick.i;
    } else {
      showToast("All kanji are known!");
    }
  } else if (state.mode === "recall") {
    const known = state.kanjiData
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => state.knownSet.has(k.Kanji));
    if (known.length === 0) {
      showToast("Mark some kanji as known first");
      return;
    }
    const pick = known[Math.floor(Math.random() * known.length)];
    state.currentIndex = pick.i;
  } else {
    state.currentIndex = (state.currentIndex + 1) % state.kanjiData.length;
  }

  saveIndex();
  render();
}

function prevKanji() {
  if (state.currentIndex === 0) return;
  state.recallRevealed = false;
  state.currentIndex--;
  saveIndex();
  render();
}

function toggleKnown() {
  const kanji = getCurrentKanji();
  if (state.knownSet.has(kanji.Kanji)) {
    state.knownSet.delete(kanji.Kanji);
    delete state.srsData[kanji.Kanji];
    state.lastAction = null;
    showToast(`${kanji.Kanji} removed`);
  } else {
    state.knownSet.add(kanji.Kanji);
    state.srsData[kanji.Kanji] = createSrsEntry();
    state.lastAction = { type: "mark", kanji: kanji.Kanji };
    showToast(`${kanji.Kanji} marked as known`);
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
  showToast(`Undid ${kanji}`);
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
  state.recallRevealed = false;

  if (mode === "review") {
    const due = getDue();
    if (due.length > 0) {
      state.currentIndex = state.kanjiData.indexOf(due[0]);
      saveIndex();
    } else {
      showToast("No reviews due right now");
    }
  } else if (mode === "recall") {
    const known = state.kanjiData.filter((k) => state.knownSet.has(k.Kanji));
    if (known.length > 0) {
      const pick = known[Math.floor(Math.random() * known.length)];
      state.currentIndex = state.kanjiData.indexOf(pick);
      saveIndex();
    } else {
      showToast("Mark some kanji as known first");
    }
  }

  render();
}

function toggleHide() {
  state.hideKanji = !state.hideKanji;
  render();
}

function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  if (state.darkMode) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  saveTheme();
  // Update meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = state.darkMode ? "#000000" : "#F2F2F7";
  render();
  if (state.activeView) renderView();
}

function openStrokeOrder() {
  const kanji = getCurrentKanji();
  const site = STROKE_ORDER_SITES[state.strokeOrderSite] || STROKE_ORDER_SITES.jisho;
  window.open(site.url(kanji.Kanji), "_blank");
}

function openLookUp() {
  const kanji = getCurrentKanji();
  const site = LOOKUP_SITES[state.lookUpSite] || LOOKUP_SITES.jisho;
  window.open(site.url(kanji.Kanji), "_blank");
}

function exportProgress() {
  const data = {
    version: "3.0",
    known: [...state.knownSet],
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
  showToast("Progress exported");
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
        if (data.known) {
          state.knownSet = new Set(data.known);
          saveKnown();
        }
        if (data.srs) {
          state.srsData = data.srs;
          saveSrs();
        }
        // Also support v2 format
        if (data.practiced && !data.known) {
          state.knownSet = new Set(data.practiced);
          saveKnown();
          for (const k of data.practiced) {
            if (!state.srsData[k]) {
              state.srsData[k] = createSrsEntry();
            }
          }
          saveSrs();
        }
        render();
        if (state.activeView) renderView();
        showToast(`Imported ${state.knownSet.size} kanji`);
      } catch {
        showToast("Invalid file format");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function exportSyncCode() {
  const code = encodeSyncCode();
  navigator.clipboard.writeText(code).then(
    () => showToast(`Sync code copied (${state.knownSet.size} kanji)`),
    () => {
      // Fallback: show in prompt
      prompt("Copy this sync code:", code);
    },
  );
}

function importSyncCode() {
  const input = document.getElementById("syncCodeInput");
  if (!input || !input.value.trim()) {
    showToast("Paste a sync code first");
    return;
  }

  const imported = decodeSyncCode(input.value);
  if (!imported) {
    showToast("Invalid sync code");
    return;
  }

  // Merge: add all imported kanji to known set
  let added = 0;
  for (const k of imported) {
    if (!state.knownSet.has(k)) {
      state.knownSet.add(k);
      if (!state.srsData[k]) {
        state.srsData[k] = createSrsEntry();
      }
      added++;
    }
  }

  saveKnown();
  saveSrs();
  input.value = "";
  render();
  if (state.activeView) renderView();
  showToast(`Synced: ${added} new, ${state.knownSet.size} total`);
}

function exportSettings() {
  const settings = {
    v: "3.0",
    t: "settings",
    darkMode: state.darkMode,
    kanjiFont: state.kanjiFont,
    strokeOrderSite: state.strokeOrderSite,
    lookUpSite: state.lookUpSite,
  };
  const code = btoa(JSON.stringify(settings));
  navigator.clipboard.writeText(code).then(
    () => showToast("Settings copied"),
    () => prompt("Copy this settings code:", code),
  );
}

function importSettings() {
  const input = document.getElementById("settingsCodeInput");
  if (!input || !input.value.trim()) {
    showToast("Paste a settings code first");
    return;
  }
  try {
    const settings = JSON.parse(atob(input.value.trim()));
    if (settings.t !== "settings") throw new Error("Not a settings code");

    if (typeof settings.darkMode === "boolean") {
      state.darkMode = settings.darkMode;
      document.documentElement.setAttribute("data-theme", state.darkMode ? "dark" : "");
      saveTheme();
    }
    if (settings.kanjiFont && KANJI_FONTS[settings.kanjiFont]) {
      state.kanjiFont = settings.kanjiFont;
      applyKanjiFont(settings.kanjiFont);
      saveFont();
    }
    if (settings.strokeOrderSite && STROKE_ORDER_SITES[settings.strokeOrderSite]) {
      state.strokeOrderSite = settings.strokeOrderSite;
    }
    if (settings.lookUpSite && LOOKUP_SITES[settings.lookUpSite]) {
      state.lookUpSite = settings.lookUpSite;
    }
    saveSitePrefs();

    input.value = "";
    render();
    if (state.activeView) renderView();
    showToast("Settings imported");
  } catch {
    showToast("Invalid settings code");
  }
}

function resetProgress() {
  showConfirm(
    "Reset Progress",
    "This will erase all your progress including known kanji and SRS data. This cannot be undone.",
    () => {
      state.knownSet.clear();
      state.srsData = {};
      state.lastAction = null;
      saveKnown();
      saveSrs();
      render();
      if (state.activeView) renderView();
      showToast("Progress reset");
    },
  );
}

/* ========================================
   Event Delegation
   ======================================== */

document.addEventListener("click", (e) => {
  // Stop propagation for confirm dialogs and marked elements
  if (e.target.closest("[data-stop-propagation]")) {
    const action = e.target.closest("[data-action]");
    if (!action) return; // block propagation by not matching any action
  }

  // Close dropdowns on any click outside dropdown toggles
  if (!e.target.closest(".split-arrow") && !e.target.closest(".split-dropdown")) {
    closeAllDropdowns();
  }

  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case "prev": prevKanji(); break;
    case "next": nextKanji(); break;
    case "toggle-known":
      if (state.knownSet.has(getCurrentKanji().Kanji)) {
        toggleKnown();
      } else {
        markKnownAndNext();
      }
      break;
    case "reveal":
      state.recallRevealed = true;
      render();
      break;
    case "stroke-order": openStrokeOrder(); break;
    case "look-up": openLookUp(); break;
    case "toggle-stroke-dropdown": toggleDropdown("strokeDropdown"); break;
    case "toggle-lookup-dropdown": toggleDropdown("lookupDropdown"); break;
    case "quick-stroke": {
      state.strokeOrderSite = target.dataset.site;
      saveSitePrefs();
      closeAllDropdowns();
      render();
      showToast(`Stroke Order → ${STROKE_ORDER_SITES[state.strokeOrderSite].label}`);
      break;
    }
    case "quick-lookup": {
      state.lookUpSite = target.dataset.site;
      saveSitePrefs();
      closeAllDropdowns();
      render();
      showToast(`Look Up → ${LOOKUP_SITES[state.lookUpSite].label}`);
      break;
    }
    case "undo": undoLastAction(); break;
    case "jump-unknown": jumpToNextUnknown(); break;
    case "cycle-font": {
      const idx = FONT_KEYS.indexOf(state.kanjiFont);
      const nextIdx = (idx + 1) % FONT_KEYS.length;
      state.kanjiFont = FONT_KEYS[nextIdx];
      applyKanjiFont(state.kanjiFont);
      saveFont();
      showToast(KANJI_FONTS[state.kanjiFont].label);
      // Update the button title without full re-render
      const btn = document.querySelector('.font-cycle-btn');
      if (btn) btn.title = KANJI_FONTS[state.kanjiFont].label;
      break;
    }
    case "toggle-dark":
      state.darkMode = !state.darkMode;
      document.documentElement.setAttribute("data-theme", state.darkMode ? "dark" : "");
      saveTheme();
      render();
      break;
    case "explorer": openView("explorer"); break;
    case "settings": openView("settings"); break;
    case "close-view": closeView(); break;
    case "explorer-select": {
      const idx = parseInt(target.dataset.index, 10);
      state.currentIndex = idx;
      state.recallRevealed = false;
      saveIndex();
      render();
      closeView();
      break;
    }
    case "filter-all": state.explorerFilter = "all"; renderView(); break;
    case "filter-known": state.explorerFilter = "known"; renderView(); break;
    case "filter-unknown": state.explorerFilter = "unknown"; renderView(); break;
    case "filter-due": state.explorerFilter = "due"; renderView(); break;
    case "export": exportProgress(); break;
    case "import": importProgress(); break;
    case "export-sync-code": exportSyncCode(); break;
    case "import-sync-code": importSyncCode(); break;
    case "export-settings": exportSettings(); break;
    case "import-settings": importSettings(); break;
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

    // Mode buttons
    case "mode-study": setMode("study"); break;
    case "mode-random": setMode("random"); break;
    case "mode-review": setMode("review"); break;
    case "mode-recall": setMode("recall"); break;

    // SRS ratings
    case "srs-1": rateSrs(1); break;
    case "srs-3": rateSrs(3); break;
    case "srs-4": rateSrs(4); break;
    case "srs-5": rateSrs(5); break;
  }
});

/* ========================================
   Change Events (selects, toggles)
   ======================================== */

document.addEventListener("change", (e) => {
  if (e.target.id === "darkModeToggle") {
    toggleDarkMode();
    return;
  }

  const action = e.target.dataset?.action;
  if (action === "change-stroke-site") {
    state.strokeOrderSite = e.target.value;
    saveSitePrefs();
  } else if (action === "change-lookup-site") {
    state.lookUpSite = e.target.value;
    saveSitePrefs();
  } else if (action === "change-kanji-font") {
    state.kanjiFont = e.target.value;
    applyKanjiFont(e.target.value);
    saveFont();
    const preview = document.querySelector(".font-preview");
    if (preview) {
      const font = KANJI_FONTS[e.target.value];
      preview.style.fontFamily = font?.family ? `"${font.family}"` : "";
    }
  }
});

/* ========================================
   Search Input
   ======================================== */

document.addEventListener("input", (e) => {
  if (e.target.id !== "explorerSearch") return;
  const val = e.target.value.trim();
  if (val.length === 1) {
    const idx = state.kanjiData.findIndex((k) => k.Kanji === val);
    if (idx !== -1) {
      state.currentIndex = idx;
      state.recallRevealed = false;
      saveIndex();
      render();
      closeView();
    }
  }
});

/* ========================================
   Keyboard Shortcuts
   ======================================== */

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

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
    case "ArrowLeft":
      e.preventDefault();
      prevKanji();
      break;
    case "ArrowRight":
    case " ":
      e.preventDefault();
      nextKanji();
      break;
    case "Enter":
      e.preventDefault();
      markKnownAndNext();
      break;
    case "h":
    case "H":
      e.preventDefault();
      toggleHide();
      break;
    case "d":
    case "D":
      e.preventDefault();
      toggleDarkMode();
      break;
    case "e":
    case "E":
      e.preventDefault();
      if (state.activeView === "explorer") {
        closeView();
      } else {
        openView("explorer");
      }
      break;
    case "s":
    case "S":
      e.preventDefault();
      openStrokeOrder();
      break;
    case "u":
    case "U":
      e.preventDefault();
      undoLastAction();
      break;
    case "Escape":
      if (state.hideKanji) {
        state.hideKanji = false;
        render();
      }
      break;
    // SRS ratings via number keys
    case "1":
      e.preventDefault();
      if (state.mode === "review" || (state.mode === "recall" && state.recallRevealed)) {
        rateSrs(1);
      }
      break;
    case "2":
      e.preventDefault();
      if (state.mode === "review" || (state.mode === "recall" && state.recallRevealed)) {
        rateSrs(3);
      }
      break;
    case "3":
      e.preventDefault();
      if (state.mode === "review" || (state.mode === "recall" && state.recallRevealed)) {
        rateSrs(4);
      }
      break;
    case "4":
      e.preventDefault();
      if (state.mode === "review" || (state.mode === "recall" && state.recallRevealed)) {
        rateSrs(5);
      }
      break;
    // Mode shortcuts
    case "r":
    case "R":
      e.preventDefault();
      if (e.shiftKey) {
        setMode("recall");
      } else {
        setMode("review");
      }
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
      <div class="loading" style="color: var(--error)">
        <p>Failed to load kanji data.</p>
        <p style="font-size: 0.875rem; opacity: 0.7">Please refresh the page.</p>
      </div>
    `;
    return;
  }

  // Clamp index
  if (state.currentIndex >= state.kanjiData.length) state.currentIndex = 0;

  // Set initial theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = state.darkMode ? "#000000" : "#F2F2F7";

  render();
}

init();
