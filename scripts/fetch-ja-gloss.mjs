#!/usr/bin/env node
/**
 * Fetch Japanese kanji glosses (短い意味) from ja.wiktionary.org.
 *
 * Input:  public/kanji_sorted.json (list of kanji)
 * Output: src/ja_gloss.json (map kanji → short Japanese gloss)
 *
 * Strategy:
 *   - Batch 50 kanji per request via MediaWiki API `action=query&prop=revisions`
 *   - Parse wikitext, find the first bullet/numbered item under 意義 / 意味 / 字義
 *   - Strip wiki markup and templates
 *   - Keep glosses under ~40 chars for display
 *
 * Usage:
 *   node scripts/fetch-ja-gloss.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const INPUT = path.join(projectRoot, "public", "kanji_sorted.json");
const OUTPUT = path.join(projectRoot, "src", "ja_gloss.json");
const LOG = path.join(projectRoot, "scripts", "ja_gloss_log.txt");

const API = "https://ja.wiktionary.org/w/api.php";
const BATCH = 50;
const DELAY_MS = 150; // polite pacing between batches

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripWikitext(s) {
  if (!s) return "";
  let t = s;
  // Remove <ref>...</ref>
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  t = t.replace(/<ref[^/]*\/>/gi, "");
  // Remove other HTML tags
  t = t.replace(/<[^>]+>/g, "");
  // Templates {{...}} — drop most, keep simple ones
  t = t.replace(/\{\{[^{}]*\}\}/g, "");
  // Links [[target|display]] → display; [[target]] → target
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  t = t.replace(/\[\[([^\]]+)\]\]/g, "$1");
  // External links [url text] → text
  t = t.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1");
  t = t.replace(/\[https?:\/\/\S+\]/g, "");
  // Bold/italic wiki markup
  t = t.replace(/'''([^']+)'''/g, "$1");
  t = t.replace(/''([^']+)''/g, "$1");
  // Leading bullets/numbers
  t = t.replace(/^[#*:;]+\s*/gm, "");
  // Collapse whitespace
  t = t.replace(/\s+/g, "").trim();
  return t;
}

function extractGloss(wikitext, kanji) {
  if (!wikitext) return null;
  // Try different section headings that contain meanings
  const sectionHeaders = [
    /==+\s*意義\s*==+/,
    /==+\s*意味\s*==+/,
    /==+\s*字義\s*==+/,
    /==+\s*名詞\s*==+/, // sometimes noun section has a succinct definition
  ];

  for (const re of sectionHeaders) {
    const m = wikitext.match(re);
    if (!m) continue;
    const startIdx = m.index + m[0].length;
    // Find end = next top/section header at same or higher level
    const afterStart = wikitext.slice(startIdx);
    const endMatch = afterStart.match(/\n==+\s*[^=]+\s*==+/);
    const sectionBody = endMatch
      ? afterStart.slice(0, endMatch.index)
      : afterStart;

    // Find first bulleted/numbered item
    const lines = sectionBody.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (!/^[#*]/.test(line)) continue;
      // Skip sub-bullets; prefer top-level
      if (/^##|^\*\*/.test(line)) continue;
      const text = stripWikitext(line);
      if (!text) continue;
      // Drop cross-references like "→同義語..." or entries that are just the kanji itself
      if (text === kanji) continue;
      if (text.length > 60) {
        // Trim to first clause
        const cut = text.split(/[。、]/)[0];
        if (cut.length >= 2 && cut.length <= 60) return cut;
        return text.slice(0, 40);
      }
      return text;
    }
  }
  return null;
}

async function fetchBatch(kanjiList) {
  const titles = kanjiList.join("|");
  const url = new URL(API);
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "revisions");
  url.searchParams.set("rvprop", "content");
  url.searchParams.set("rvslots", "main");
  url.searchParams.set("titles", titles);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("redirects", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent":
        "next-kanji-ja-gloss/1.0 (https://github.com/slowpokelu/next-kanji) node-fetch",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  const out = {};
  const pages = data.query?.pages || [];
  for (const page of pages) {
    if (page.missing) continue;
    const kanji = page.title;
    const wikitext = page.revisions?.[0]?.slots?.main?.content;
    if (!wikitext) continue;
    const gloss = extractGloss(wikitext, kanji);
    if (gloss) out[kanji] = gloss;
  }
  // Track redirects so the source kanji maps correctly
  for (const r of data.query?.redirects || []) {
    if (out[r.to]) out[r.from] = out[r.to];
  }
  return out;
}

async function main() {
  console.log(`Reading kanji list from ${INPUT}`);
  const raw = await readFile(INPUT, "utf8");
  const kanjiData = JSON.parse(raw);
  const kanji = kanjiData.map((k) => k.Kanji);
  console.log(`Total kanji: ${kanji.length}`);

  const result = {};
  const missing = [];

  for (let i = 0; i < kanji.length; i += BATCH) {
    const batch = kanji.slice(i, i + BATCH);
    const pct = ((i / kanji.length) * 100).toFixed(1);
    process.stdout.write(
      `\rBatch ${Math.floor(i / BATCH) + 1}/${Math.ceil(kanji.length / BATCH)} ` +
      `(${pct}%) — ${Object.keys(result).length} hits so far`,
    );
    try {
      const batchResult = await fetchBatch(batch);
      for (const k of batch) {
        if (batchResult[k]) result[k] = batchResult[k];
        else missing.push(k);
      }
    } catch (err) {
      console.error(`\nBatch failed: ${err.message}`);
      for (const k of batch) missing.push(k);
    }
    await sleep(DELAY_MS);
  }

  console.log(
    `\n\nDone. ${Object.keys(result).length}/${kanji.length} kanji have a gloss.`,
  );
  console.log(`Missing: ${missing.length}`);

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(result, null, 0) + "\n", "utf8");
  console.log(`Written to ${OUTPUT}`);

  await writeFile(
    LOG,
    `Generated ${new Date().toISOString()}\n` +
      `Total: ${kanji.length}\n` +
      `Hits:  ${Object.keys(result).length}\n` +
      `Missing: ${missing.length}\n\n` +
      `Missing kanji:\n${missing.join(" ")}\n`,
    "utf8",
  );
  console.log(`Log: ${LOG}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
