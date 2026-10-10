// Scriptorium conflict detector — populates the Conflicts queue (Area 1).
// Seeds the curated, hand-audited findings, then adds automated SPELL LIST
// cross-checks for any spell not already curated. (The broken-link detector was
// removed — it produced false positives on unresolved 'tps'/'travel_points'.)
//
//   node scripts/detect.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { CURATED } from "./curated.mjs";

const rows = readFileSync("scripts/out/articles.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const bySlug = new Map(rows.map((a) => [a.slug, a]));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const now = Math.floor(Date.now() / 1000);
const conflicts = [];
const sev = (k) => (k === "no" ? "error" : k === "wa" ? "warn" : "ok");

// ---- Curated findings (from the prototype) ----
const curatedSlugs = new Set();
for (const it of CURATED) {
  const slug = it.file.replace(/^help\//, "");
  curatedSlugs.add(slug);
  conflicts.push({
    category: it.cat, slug, title: it.title, kicker: it.kicker, cite: it.cite || null,
    standing: it.stand, src_a_name: it.recon.a.name, src_a_body: it.recon.a.body,
    src_b_name: it.recon.b.name, src_b_body: it.recon.b.body, note: it.note,
    checks: it.checks.map(([k, label, detail]) => ({ severity: sev(k), label, detail })),
    diff: it.diff || null, suggested: it.clean || null, suggested_label: it.cleanLabel || null,
    fingerprint: `curated:${it.id}`,
  });
}

// ---- Automated: SPELL LIST vs each spell's field block (level + min mana) ----
const sl = bySlug.get("spell_list");
const spellMap = new Map();
if (sl) {
  const lines = sl.body.split("\n").map((l) => l.trim()).filter(Boolean);
  let level = null, pending = null;
  for (const line of lines) {
    if (/^\d+$/.test(line)) { level = parseInt(line); pending = null; continue; }
    const m = line.match(/^\((\d+)\)$/);
    if (m && pending && level != null) { spellMap.set(norm(pending), { level, mana: parseInt(m[1]) }); pending = null; }
    else if (!/^(Level|Magic User|Cleric|Shaman)$/i.test(line)) pending = line;
  }
}
for (const a of rows) {
  if (curatedSlugs.has(a.slug)) continue; // don't duplicate a curated finding
  if (!a.fieldBlock || !/Min\.?\s*Mana/i.test(a.fieldBlock)) continue;
  const manaM = a.fieldBlock.match(/Min\.?\s*Mana\s*:\s*(\d+)/i);
  const lvlM = a.fieldBlock.match(/Level\s*:\s*Level\s*(\d+)/i);
  if (!manaM) continue;
  const listed = spellMap.get(norm(a.title.split(/[,/]/)[0]));
  if (!listed) continue;
  const pageMana = parseInt(manaM[1]), pageLvl = lvlM ? parseInt(lvlM[1]) : null;
  const manaBad = listed.mana !== pageMana, lvlBad = pageLvl != null && listed.level !== pageLvl;
  if (!manaBad && !lvlBad) continue;
  const what = [manaBad ? `min mana (${listed.mana} vs ${pageMana})` : "", lvlBad ? `level (${listed.level} vs ${pageLvl})` : ""].filter(Boolean).join(" and ");
  conflicts.push({
    category: "conflict", slug: a.slug, title: a.title, kicker: "Numeric conflict", cite: null,
    standing: `SPELL LIST and this spell's own page disagree on ${what}. A player following either could mis-plan a cast.`,
    src_a_name: "help/spell_list", src_a_body: `${a.title.split(/[,/]/)[0].trim()}   level ${listed.level}   min mana (<mark>${listed.mana}</mark>)`,
    src_b_name: `help/${a.slug} — field block`, src_b_body: a.fieldBlock.split("\n").filter((l) => /Level|Mana|Class/i.test(l)).join("\n"),
    note: "Detected automatically by cross-checking the field block against SPELL LIST. Which source the game reads from needs a Vala to confirm.",
    checks: [
      { severity: manaBad ? "error" : "ok", label: manaBad ? "Min mana disagrees" : "Min mana agrees", detail: `${listed.mana} vs ${pageMana}` },
      { severity: "warn", label: "Authority unconfirmed", detail: "needs a Vala to confirm the source" },
    ],
    diff: null, suggested: null, suggested_label: null, fingerprint: `spelllist:${a.slug}`,
  });
}

// ---- learning: suppress findings a reviewer already rejected ----
// conflict_feedback accumulates every "not a real conflict" reason. Skip any
// finding whose fingerprint appears there, so the detector doesn't re-flag what
// we've been told is wrong.
let suppressed = 0;
try {
  const out = spawnSync("npx", ["wrangler", "d1", "execute", "scriptorium", "--remote", "--json",
    "--command", "SELECT DISTINCT fingerprint FROM conflict_feedback WHERE fingerprint IS NOT NULL"],
    { encoding: "utf8" });
  if (out.status === 0) {
    const parsed = JSON.parse(out.stdout);
    const rejected = new Set(((Array.isArray(parsed) ? parsed[0] : parsed).results ?? []).map((r) => r.fingerprint));
    const before = conflicts.length;
    for (let i = conflicts.length - 1; i >= 0; i--) if (rejected.has(conflicts[i].fingerprint)) conflicts.splice(i, 1);
    suppressed = before - conflicts.length;
  } else {
    console.warn("could not read conflict_feedback (continuing without suppression):", out.stderr?.slice(0, 200));
  }
} catch (e) {
  console.warn("conflict_feedback lookup failed (continuing):", e.message);
}

// ---- write SQL ----
const q = (v) => (v == null ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'");
let sql = "DELETE FROM conflicts;\n";
for (const c of conflicts) {
  sql += `INSERT INTO conflicts (category,slug,title,kicker,cite,standing,src_a_name,src_a_body,src_b_name,src_b_body,note,checks,diff,suggested,suggested_label,fingerprint,status,created_at) VALUES (` +
    `${q(c.category)},${q(c.slug)},${q(c.title)},${q(c.kicker)},${q(c.cite)},${q(c.standing)},${q(c.src_a_name)},${q(c.src_a_body)},` +
    `${q(c.src_b_name)},${q(c.src_b_body)},${q(c.note)},${q(JSON.stringify(c.checks))},${q(c.diff ? JSON.stringify(c.diff) : null)},` +
    `${q(c.suggested)},${q(c.suggested_label)},${q(c.fingerprint)},'open',${now});\n`;
}
writeFileSync("scripts/out/conflicts.sql", sql);
const byCat = conflicts.reduce((m, c) => ((m[c.category] = (m[c.category] || 0) + 1), m), {});
console.log(`Detected ${conflicts.length} conflicts:`, byCat, suppressed ? `(${suppressed} suppressed by rejection feedback)` : "");

const r = spawnSync("npx", ["wrangler", "d1", "execute", "scriptorium", "--remote", "--file", "scripts/out/conflicts.sql"], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
console.log("Seeded conflicts into remote D1.");
