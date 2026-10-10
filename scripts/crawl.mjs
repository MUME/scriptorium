// Scriptorium help-file crawler.
// Pulls every topic from mume.org/help/subjects, parses each page into a clean
// article record (title, field block, body text, See-Also links, body hash) and
// writes them to scripts/out/articles.jsonl for seeding into D1.
//
//   node scripts/crawl.mjs            # full crawl (all topics)
//   LIMIT=5 node scripts/crawl.mjs    # first 5 topics (validation)
//   ONLY=find_the_path,elf node scripts/crawl.mjs

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://mume.org/help";
const CONCURRENCY = 4;
const DELAY_MS = 250;
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : 0;
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

const ENTITIES = {
  "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&mdash;": "—", "&ndash;": "–", "&nbsp;": " ", "&hellip;": "…",
  "&rsquo;": "’", "&lsquo;": "‘", "&rdquo;": "”", "&ldquo;": "“",
};
const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
   .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? m);

// Strip tags but keep text and the newlines the source already has.
const stripTags = (html) => decode(html.replace(/<[^>]+>/g, "")).replace(/[ \t]+\n/g, "\n").trimEnd();

async function getTopics() {
  const html = await (await fetch(`${BASE}/subjects`)).text();
  const content = html.slice(html.indexOf('<div class="content"'));
  const slugs = new Set();
  for (const m of content.matchAll(/<a href="([a-z0-9_]+)"(?:[^>]*)>/g)) {
    const s = m[1];
    if (s !== "subjects") slugs.add(s);
  }
  return [...slugs];
}

function parse(slug, html) {
  // Content region = from the topic's <h1> to the end of the article.
  const h1i = html.indexOf("<h1>");
  const arti = html.indexOf("</article>", h1i);
  if (h1i === -1) return null;
  const region = html.slice(h1i, arti === -1 ? undefined : arti);

  const title = stripTags((region.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || slug).trim();

  // Field block: the <pre> inside <div class="sml"> (present on spells/skills/commands).
  const preM = region.match(/<div class="sml">\s*<pre>([\s\S]*?)<\/pre>/);
  const fieldBlock = preM ? stripTags(preM[1]) : null;

  // See-Also / inline cross-references: relative help slugs linked in the body.
  const links = new Set();
  for (const m of region.matchAll(/<a href="([a-z0-9_]+)"(?:[^>]*)>/g)) {
    if (m[1] !== "subjects") links.add(m[1]);
  }

  // Body = the full help article as text (field block + prose), formatting preserved.
  // Cut off the site footer that follows every page ("Generated on <date>" then the
  // "What is MUME? … Ready to explore? Play Now" boilerplate).
  let body = stripTags(region.replace(/<h1>[\s\S]*?<\/h1>\s*<hr>?/, "")).replace(/^\n+/, "");
  body = body.replace(/\n+Generated on [\s\S]*$/, "").trimEnd();

  return { slug, title, fieldBlock, body, links: [...links] };
}

async function crawl() {
  let topics = ONLY.length ? ONLY : await getTopics();
  if (LIMIT) topics = topics.slice(0, LIMIT);
  console.log(`Crawling ${topics.length} topics (concurrency ${CONCURRENCY})…`);

  const out = [];
  let done = 0;
  async function worker(queue) {
    for (const slug of queue) {
      try {
        const res = await fetch(`${BASE}/${slug}`);
        if (!res.ok) { console.warn(`  ${slug}: HTTP ${res.status}`); continue; }
        const parsed = parse(slug, await res.text());
        if (!parsed) { console.warn(`  ${slug}: no content`); continue; }
        parsed.body_hash = createHash("sha256").update(parsed.body).digest("hex").slice(0, 16);
        parsed.fetched_at = Math.floor(Date.now() / 1000);
        out.push(parsed);
      } catch (e) {
        console.warn(`  ${slug}: ${e.message}`);
      }
      if (++done % 50 === 0) console.log(`  …${done}/${topics.length}`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  // Split topics across CONCURRENCY workers.
  const queues = Array.from({ length: CONCURRENCY }, () => []);
  topics.forEach((t, i) => queues[i % CONCURRENCY].push(t));
  await Promise.all(queues.map(worker));

  // Collapse aliases: slugs whose body_hash matches share one article; the
  // canonical slug is the one whose slug best matches the title, else the shortest.
  const byHash = new Map();
  for (const a of out) (byHash.get(a.body_hash) || byHash.set(a.body_hash, []).get(a.body_hash)).push(a);
  let articles = 0;
  const collapsed = [];
  for (const group of byHash.values()) {
    group.sort((x, y) => x.slug.length - y.slug.length);
    const canon = group[0];
    canon.aliases = group.slice(1).map((g) => g.slug);
    collapsed.push(canon);
    articles++;
  }

  mkdirSync("scripts/out", { recursive: true });
  writeFileSync("scripts/out/articles.jsonl", collapsed.map((a) => JSON.stringify(a)).join("\n") + "\n");
  console.log(`\nDone. ${out.length} pages -> ${articles} distinct articles (aliases collapsed).`);
  console.log(`Wrote scripts/out/articles.jsonl`);
}

crawl();
