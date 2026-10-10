// Seed the crawled corpus (scripts/out/articles.jsonl) into the remote D1.
// Chunks the articles into SQL files and applies each with wrangler d1 execute.
//
//   node scripts/seed.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const CHUNK = 40;
const rows = readFileSync("scripts/out/articles.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const now = Math.floor(Date.now() / 1000);

const q = (v) => (v === null || v === undefined ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'");

const cols = "slug,title,aliases,field_block,body,body_hash,links,status,first_seen,last_seen";
function insert(a) {
  const vals = `(${q(a.slug)},${q(a.title)},${q(JSON.stringify(a.aliases || []))},${q(a.fieldBlock)},` +
    `${q(a.body)},${q(a.body_hash)},${q(JSON.stringify(a.links || []))},'live',` +
    `${a.fetched_at || now},${a.fetched_at || now})`;
  return `INSERT INTO articles (${cols}) VALUES ${vals};`;
}

mkdirSync("scripts/out", { recursive: true });
const files = [];
// First file clears the table.
let firstChunk = true;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  let sql = firstChunk ? "DELETE FROM articles;\n" : "";
  firstChunk = false;
  sql += chunk.map(insert).join("\n") + "\n";
  const fn = `scripts/out/seed_${String(files.length).padStart(2, "0")}.sql`;
  writeFileSync(fn, sql);
  files.push(fn);
}
console.log(`Prepared ${files.length} chunk files for ${rows.length} articles.`);

for (const fn of files) {
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "scriptorium", "--remote", "--file", fn], { encoding: "utf8" });
  if (r.status !== 0) { console.error(`FAILED ${fn}:\n${r.stderr}`); process.exit(1); }
  process.stdout.write(".");
}
console.log(`\nSeeded ${rows.length} articles into remote D1.`);
