// Scriptorium scan: re-crawl the live help files and reconcile with D1.
//
//   node scripts/scan.mjs            # full re-crawl, then reconcile
//   node scripts/scan.mjs --dry      # crawl + report, write nothing
//
// What it does, per file:
//   - body unchanged            -> just bump last_seen
//   - body changed              -> update stored body/hash/fields/links + last_seen
//   - body changed AND the file has an APPROVED (in-queue) proposal
//                               -> auto-apply it: proposal.status='applied',
//                                  article.applied_at=now  (the edit went live in-game)
//   - brand-new slug            -> insert as a live article
//
// This is the trigger for "Approved · in queue" -> "Approved · applied": once the
// change an approver queued actually shows up in the game's help text, the next scan
// notices the body moved and closes the loop. An approver can also apply by hand.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const now = Math.floor(Date.now() / 1000);
const q = (v) => (v === null || v === undefined ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'");

function d1(args) {
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "scriptorium", "--remote", ...args], { encoding: "utf8" });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
  return r.stdout;
}
function d1json(sql) {
  const out = d1(["--json", "--command", sql]);
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed[0] : parsed).results ?? [];
}

// 1. Fresh crawl.
console.log("Re-crawling live help files…");
const crawl = spawnSync("node", ["scripts/crawl.mjs"], { encoding: "utf8", stdio: "inherit" });
if (crawl.status !== 0) process.exit(1);
const fresh = readFileSync("scripts/out/articles.jsonl", "utf8").trim().split("\n").map(JSON.parse);

// 2. Current state from D1.
const haveRows = d1json("SELECT slug, body_hash FROM articles");
const have = new Map(haveRows.map((r) => [r.slug, r.body_hash]));
const queuedRows = d1json("SELECT slug, id FROM proposals WHERE status='approved'");
const queued = new Map(queuedRows.map((r) => [r.slug, r.id])); // slug -> proposal id in queue

// 3. Reconcile.
const stmts = [];
let changed = 0, applied = 0, added = 0;
for (const a of fresh) {
  const prev = have.get(a.slug);
  if (prev === undefined) {
    stmts.push(
      `INSERT INTO articles (slug,title,aliases,field_block,body,body_hash,links,status,first_seen,last_seen) VALUES (` +
      `${q(a.slug)},${q(a.title)},${q(JSON.stringify(a.aliases || []))},${q(a.fieldBlock)},${q(a.body)},` +
      `${q(a.body_hash)},${q(JSON.stringify(a.links || []))},'live',${now},${now});`);
    added++;
    continue;
  }
  if (prev === a.body_hash) {
    stmts.push(`UPDATE articles SET last_seen=${now} WHERE slug=${q(a.slug)};`);
    continue;
  }
  // Body moved.
  changed++;
  stmts.push(
    `UPDATE articles SET title=${q(a.title)}, field_block=${q(a.fieldBlock)}, body=${q(a.body)}, ` +
    `body_hash=${q(a.body_hash)}, links=${q(JSON.stringify(a.links || []))}, last_seen=${now} WHERE slug=${q(a.slug)};`);
  const qid = queued.get(a.slug);
  if (qid != null) {
    // Auto-apply: the queued edit is now live in-game.
    applied++;
    stmts.push(`UPDATE proposals SET status='applied', updated_at=${now} WHERE id=${qid};`);
    stmts.push(
      `INSERT INTO decisions (proposal_id, actor_id, actor_name, verdict, note, decided_at) ` +
      `VALUES (${qid}, 'scan', 'Scan', 'applied', 'Detected in the live help text', ${now});`);
    stmts.push(`UPDATE articles SET applied_at=${now} WHERE slug=${q(a.slug)};`);
  }
}

console.log(`\nScan: ${fresh.length} files — ${changed} changed, ${added} new, ${applied} queued edit(s) auto-applied.`);
if (DRY) { console.log("(dry run — nothing written)"); process.exit(0); }
if (!stmts.length) process.exit(0);

// 4. Apply in batches (one statement per line; keep files well under the SQLITE_TOOBIG limit).
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync("scripts/out", { recursive: true });
const BATCH = 60;
for (let i = 0; i < stmts.length; i += BATCH) {
  const fn = `scripts/out/scan_${String(i / BATCH).padStart(3, "0")}.sql`;
  writeFileSync(fn, stmts.slice(i, i + BATCH).join("\n") + "\n");
  d1(["--file", fn]);
  process.stdout.write(".");
}
console.log(`\nReconciled ${stmts.length} statement(s) into remote D1.`);
