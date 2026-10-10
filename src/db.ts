import type { Env, Article, Proposal } from "./types";

function rowToArticle(r: any): Article {
  return {
    slug: r.slug, title: r.title,
    aliases: JSON.parse(r.aliases || "[]"),
    field_block: r.field_block, body: r.body, body_hash: r.body_hash,
    links: JSON.parse(r.links || "[]"),
    status: r.status, first_seen: r.first_seen, last_seen: r.last_seen,
  };
}

// Browse: title/slug/body search, newest-touched first. Returns light rows with
// per-file lifecycle flags (open reviews, and whether it is locked in the queue).
const LIST_COLS = `a.slug, a.title, a.field_block IS NOT NULL AS has_fields,
  (SELECT COUNT(*) FROM proposals p WHERE p.slug=a.slug AND p.status IN ('submitted','held')) AS open,
  (SELECT COUNT(*) FROM proposals p WHERE p.slug=a.slug AND p.status='approved') AS queued`;
export async function listArticles(env: Env, q: string, limit = 400): Promise<any[]> {
  if (q) {
    const like = `%${q}%`;
    const res = await env.DB.prepare(
      `SELECT ${LIST_COLS} FROM articles a
       WHERE a.title LIKE ?1 OR a.slug LIKE ?1 OR a.body LIKE ?1
       ORDER BY (a.title LIKE ?2) DESC, a.title ASC LIMIT ?3`,
    ).bind(like, `${q}%`, limit).all();
    return res.results ?? [];
  }
  const res = await env.DB.prepare(
    `SELECT ${LIST_COLS} FROM articles a ORDER BY a.title ASC LIMIT ?1`,
  ).bind(limit).all();
  return res.results ?? [];
}

// Lifecycle state of one file: is it locked in the approval queue, and is there
// an open (in-review) proposal to merge new edits into.
export async function fileState(env: Env, slug: string): Promise<{ queued: boolean; inReview: boolean; openId: number | null; openAfter: string | null; reviewRequestedAt: number | null; approvedAt: number | null; appliedAt: number | null }> {
  const r = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM proposals WHERE slug=?1 AND status='approved') AS queued,
       (SELECT COUNT(*) FROM proposals WHERE slug=?1 AND status IN ('submitted','held')) AS in_review,
       (SELECT id FROM proposals WHERE slug=?1 AND status IN ('submitted','held') ORDER BY updated_at DESC LIMIT 1) AS open_id,
       (SELECT body_after FROM proposals WHERE slug=?1 AND status IN ('submitted','held') ORDER BY updated_at DESC LIMIT 1) AS open_after,
       (SELECT review_requested_at FROM articles WHERE slug=?1) AS rr,
       (SELECT approved_at FROM articles WHERE slug=?1) AS ap,
       (SELECT applied_at FROM articles WHERE slug=?1) AS apl`,
  ).bind(slug).first<any>();
  return {
    queued: (r?.queued || 0) > 0, inReview: (r?.in_review || 0) > 0,
    openId: r?.open_id ?? null, openAfter: r?.open_after ?? null,
    reviewRequestedAt: r?.rr ?? null, approvedAt: r?.ap ?? null, appliedAt: r?.apl ?? null,
  };
}

// Mark all open proposals on a slug (except newId) as merged into newId.
export async function supersedeOpen(env: Env, slug: string, newId: number) {
  await env.DB.prepare(
    "UPDATE proposals SET status='superseded', superseded_by=?, updated_at=? WHERE slug=? AND status IN ('submitted','held') AND id!=?",
  ).bind(newId, Math.floor(Date.now() / 1000), slug, newId).run();
}

// Stamp an article-level review timestamp (Scriptorium's own record).
export async function touchArticle(env: Env, slug: string, field: "review_requested_at" | "approved_at" | "applied_at", ts: number) {
  await env.DB.prepare(`UPDATE articles SET ${field}=? WHERE slug=?`).bind(ts, slug).run();
}

export async function articleCount(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) c FROM articles").first<{ c: number }>();
  return r?.c ?? 0;
}

// Resolve by slug or by alias membership.
export async function getArticle(env: Env, slug: string): Promise<Article | null> {
  let r = await env.DB.prepare("SELECT * FROM articles WHERE slug = ?").bind(slug).first();
  if (!r) {
    r = await env.DB.prepare(
      "SELECT * FROM articles WHERE EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = ?)",
    ).bind(slug).first();
  }
  return r ? rowToArticle(r) : null;
}

export async function allSlugsAndAliases(env: Env): Promise<Set<string>> {
  const res = await env.DB.prepare("SELECT slug, aliases FROM articles").all<any>();
  const set = new Set<string>();
  for (const r of res.results ?? []) {
    set.add(r.slug);
    for (const a of JSON.parse(r.aliases || "[]")) set.add(a);
  }
  return set;
}

export async function createProposal(
  env: Env, p: Omit<Proposal, "id" | "created_at" | "updated_at" | "status">,
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB.prepare(
    `INSERT INTO proposals (slug, author_id, author_name, kind, rationale, body_before, body_after, note_review, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,'submitted',?,?)`,
  ).bind(p.slug, p.author_id, p.author_name, p.kind, p.rationale, p.body_before, p.body_after, p.note_review, now, now).run();
  return res.meta.last_row_id as number;
}

export async function saveChecks(env: Env, proposalId: number, checks: { key: string; severity: string; detail: string }[]) {
  for (const c of checks) {
    await env.DB.prepare("INSERT INTO proposal_checks (proposal_id, check_key, severity, detail) VALUES (?,?,?,?)")
      .bind(proposalId, c.key, c.severity, c.detail).run();
  }
}

export async function listProposals(env: Env, statuses: string[]): Promise<Proposal[]> {
  const ph = statuses.map(() => "?").join(",");
  // Carry the most recent decline reason along, so the Rejected view can show it
  // without a follow-up query per row.
  const res = await env.DB.prepare(
    `SELECT p.*,
       (SELECT note FROM decisions d WHERE d.proposal_id=p.id AND d.verdict='declined' ORDER BY d.decided_at DESC LIMIT 1) AS decline_note,
       (SELECT actor_name FROM decisions d WHERE d.proposal_id=p.id AND d.verdict='declined' ORDER BY d.decided_at DESC LIMIT 1) AS decline_by,
       (SELECT decided_at FROM decisions d WHERE d.proposal_id=p.id AND d.verdict='declined' ORDER BY d.decided_at DESC LIMIT 1) AS decline_at
     FROM proposals p WHERE p.status IN (${ph}) ORDER BY p.updated_at DESC`,
  ).bind(...statuses).all<Proposal>();
  return (res.results ?? []) as Proposal[];
}

export async function getProposal(env: Env, id: number): Promise<Proposal | null> {
  return (await env.DB.prepare("SELECT * FROM proposals WHERE id = ?").bind(id).first<Proposal>()) ?? null;
}

export async function getProposalChecks(env: Env, id: number): Promise<any[]> {
  const res = await env.DB.prepare("SELECT check_key, severity, detail FROM proposal_checks WHERE proposal_id = ?").bind(id).all();
  return res.results ?? [];
}

export async function decide(
  env: Env, proposalId: number, actorId: string, actorName: string, verdict: string, note: string | null, isTest = false,
) {
  const now = Math.floor(Date.now() / 1000);
  const map: Record<string, string> = {
    approve: "approved", decline: "declined", hold: "held", reopen: "submitted", apply: "applied",
  };
  const status = map[verdict] ?? verdict;
  const p = await env.DB.prepare("SELECT slug FROM proposals WHERE id = ?").bind(proposalId).first<{ slug: string }>();
  await env.DB.prepare("UPDATE proposals SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, proposalId).run();
  await env.DB.prepare(
    "INSERT INTO decisions (proposal_id, actor_id, actor_name, verdict, note, decided_at, is_test) VALUES (?,?,?,?,?,?,?)",
  ).bind(proposalId, actorId, actorName, verdict === "reopen" ? "reopened" : status, note, now, isTest ? 1 : 0).run();
  // Stamp the file's own record: approved (entered queue) / applied (went live).
  if (p?.slug && status === "approved") await touchArticle(env, p.slug, "approved_at", now);
  if (p?.slug && status === "applied") await touchArticle(env, p.slug, "applied_at", now);
}

export async function getDecisions(env: Env, proposalId: number): Promise<any[]> {
  const res = await env.DB.prepare(
    "SELECT actor_name, verdict, note, decided_at FROM decisions WHERE proposal_id = ? ORDER BY decided_at ASC",
  ).bind(proposalId).all();
  return res.results ?? [];
}

export async function listConflicts(env: Env): Promise<any[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM conflicts WHERE status='open'
     ORDER BY CASE category WHEN 'conflict' THEN 0 WHEN 'stale' THEN 1 ELSE 2 END, id`,
  ).all();
  return (res.results ?? []).map((c: any) => ({ ...c, checks: JSON.parse(c.checks || "[]"), diff: c.diff ? JSON.parse(c.diff) : null }));
}

// Append-only login log. One row every successful sign-in.
export async function logLogin(env: Env, id: string, name: string, tier: string) {
  await env.DB.prepare(
    "INSERT INTO login_events (discord_id, username, tier, at) VALUES (?,?,?,?)",
  ).bind(id, name, tier, Math.floor(Date.now() / 1000)).run();
}

// Recent logins (approver-only view). Newest first.
export async function listLogins(env: Env, limit = 200): Promise<any[]> {
  const res = await env.DB.prepare(
    "SELECT discord_id, username, tier, at FROM login_events ORDER BY at DESC LIMIT ?",
  ).bind(limit).all();
  return res.results ?? [];
}

// Reject a detected conflict as not-a-real-conflict, with a reason. Marks the
// conflict row (so it leaves the open list) and appends to the feedback KB.
export async function rejectConflict(
  env: Env, id: number, actorId: string, actorName: string, reason: string, isTest = false,
): Promise<boolean> {
  const c = await env.DB.prepare(
    "SELECT id, fingerprint, slug, category, title FROM conflicts WHERE id = ? AND status = 'open'",
  ).bind(id).first<any>();
  if (!c) return false;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "UPDATE conflicts SET status='rejected', reject_reason=?, rejected_by=?, rejected_at=? WHERE id=?",
  ).bind(reason, actorName, now, id).run();
  await env.DB.prepare(
    `INSERT INTO conflict_feedback (fingerprint, conflict_id, slug, category, title, reason, actor_id, actor_name, at, is_test)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(c.fingerprint ?? null, c.id, c.slug, c.category ?? null, c.title ?? null, reason, actorId, actorName, now, isTest ? 1 : 0).run();
  return true;
}

// Undo everything TEST reviewers have done, without touching real reviewers' work:
//  - drop test decisions, then recompute each affected proposal's status from the
//    remaining (real) decisions (or back to 'submitted' if none) — 'superseded' rows
//    are left alone (that status comes from a merge, not a decision);
//  - restore conflicts a test reviewer rejected back to 'open' and delete their
//    feedback rows (real rejections stay);
//  - recompute the affected articles' approved_at/applied_at stamps.
export async function resetTestActivity(env: Env): Promise<{ decisions: number; conflicts: number; feedback: number }> {
  const now = Math.floor(Date.now() / 1000);
  // Proposals touched by a test decision (before we delete them).
  const affected = await env.DB.prepare(
    "SELECT DISTINCT p.id, p.slug FROM decisions d JOIN proposals p ON p.id=d.proposal_id WHERE d.is_test=1",
  ).all<any>();
  const proposals = affected.results ?? [];
  const decCount = await env.DB.prepare("SELECT COUNT(*) c FROM decisions WHERE is_test=1").first<{ c: number }>();
  await env.DB.prepare("DELETE FROM decisions WHERE is_test=1").run();

  // Recompute each affected proposal's status from its remaining real decisions.
  const dmap: Record<string, string> = { approved: "approved", declined: "declined", held: "held", applied: "applied", reopened: "submitted" };
  const slugs = new Set<string>();
  for (const p of proposals) {
    slugs.add(p.slug);
    const cur = await env.DB.prepare("SELECT status FROM proposals WHERE id=?").bind(p.id).first<{ status: string }>();
    if (cur?.status === "superseded") continue; // not decision-driven
    const last = await env.DB.prepare(
      "SELECT verdict FROM decisions WHERE proposal_id=? ORDER BY decided_at DESC LIMIT 1",
    ).bind(p.id).first<{ verdict: string }>();
    const status = last ? (dmap[last.verdict] ?? "submitted") : "submitted";
    await env.DB.prepare("UPDATE proposals SET status=?, updated_at=? WHERE id=?").bind(status, now, p.id).run();
  }

  // Restore conflicts that a test reviewer rejected.
  const testFb = await env.DB.prepare("SELECT DISTINCT conflict_id FROM conflict_feedback WHERE is_test=1 AND conflict_id IS NOT NULL").all<any>();
  let conflictsRestored = 0;
  for (const r of testFb.results ?? []) {
    const res = await env.DB.prepare(
      "UPDATE conflicts SET status='open', reject_reason=NULL, rejected_by=NULL, rejected_at=NULL WHERE id=? AND status='rejected'",
    ).bind(r.conflict_id).run();
    if ((res.meta?.changes ?? 0) > 0) conflictsRestored++;
  }
  const fbCount = await env.DB.prepare("SELECT COUNT(*) c FROM conflict_feedback WHERE is_test=1").first<{ c: number }>();
  await env.DB.prepare("DELETE FROM conflict_feedback WHERE is_test=1").run();

  // Recompute article stamps for affected slugs from surviving proposals.
  for (const slug of slugs) {
    const ap = await env.DB.prepare(
      "SELECT MAX(updated_at) t FROM proposals WHERE slug=? AND status IN ('approved','applied')",
    ).bind(slug).first<{ t: number | null }>();
    const apl = await env.DB.prepare(
      "SELECT MAX(updated_at) t FROM proposals WHERE slug=? AND status='applied'",
    ).bind(slug).first<{ t: number | null }>();
    await env.DB.prepare("UPDATE articles SET approved_at=?, applied_at=? WHERE slug=?")
      .bind(ap?.t ?? null, apl?.t ?? null, slug).run();
  }

  return { decisions: decCount?.c ?? 0, conflicts: conflictsRestored, feedback: fbCount?.c ?? 0 };
}

// The learning signal: every rejected-conflict reason. Read by the detector to
// suppress known-false findings, and available for review.
export async function listConflictFeedback(env: Env, limit = 500): Promise<any[]> {
  const res = await env.DB.prepare(
    "SELECT fingerprint, slug, category, title, reason, actor_name, at FROM conflict_feedback ORDER BY at DESC LIMIT ?",
  ).bind(limit).all();
  return res.results ?? [];
}

export async function upsertUser(env: Env, id: string, name: string, roles: string[], tier: string) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO users (discord_id, username, tier, roles_json, last_seen) VALUES (?,?,?,?,?)
     ON CONFLICT(discord_id) DO UPDATE SET username=excluded.username, tier=excluded.tier, roles_json=excluded.roles_json, last_seen=excluded.last_seen`,
  ).bind(id, name, tier, JSON.stringify(roles), now).run();
}
