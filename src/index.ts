import type { Env } from "./types";
import * as db from "./db";
import { runChecks } from "./checks";
import { authorizeUrl, completeLogin } from "./discord";
import { readSession, makeSession, sessionCookie, clearCookie, stateCookie } from "./session";
import APP_HTML from "../public/app.html";

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const cookie = request.headers.get("Cookie");
    const session = await readSession(env, cookie);

    try {
      // ---- auth ----
      if (path === "/auth/login") {
        const state = crypto.randomUUID();
        return new Response(null, { status: 302, headers: { Location: authorizeUrl(env, state), "Set-Cookie": stateCookie(state) } });
      }
      if (path === "/auth/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const savedState = (cookie?.match(/scr_state=([^;]+)/) || [])[1];
        if (!code || !state || state !== savedState) return Response.redirect(`${env.PUBLIC_BASE_URL}/?err=state`, 302);
        const s = await completeLogin(env, code);
        if (!s) return Response.redirect(`${env.PUBLIC_BASE_URL}/?err=guild`, 302);
        const tier = s.approver ? "approver" : s.council ? "council" : "member";
        await db.upsertUser(env, s.id, s.name, [], tier).catch(() => {});
        await db.logLogin(env, s.id, s.name, tier).catch(() => {});
        const token = await makeSession(env, s);
        return new Response(null, { status: 302, headers: { Location: `${env.PUBLIC_BASE_URL}/`, "Set-Cookie": sessionCookie(token) } });
      }
      if (path === "/auth/logout") {
        return new Response(null, { status: 302, headers: { Location: `${env.PUBLIC_BASE_URL}/`, "Set-Cookie": clearCookie } });
      }

      // ---- api ----
      if (path === "/api/me") {
        return json({ session, configured: !!env.DISCORD_CLIENT_SECRET, owner: !!session && session.id === env.OWNER_ID });
      }
      if (path === "/api/logins" && request.method === "GET") {
        if (!session || session.id !== env.OWNER_ID) return json({ error: "not found" }, { status: 404 });
        return json({ logins: await db.listLogins(env) });
      }
      if (path === "/health") {
        return json({ ok: true, articles: await db.articleCount(env) });
      }
      if (path === "/api/conflicts" && request.method === "GET") {
        return json({ conflicts: await db.listConflicts(env) });
      }
      if (path === "/api/conflicts/feedback" && request.method === "GET") {
        if (!session?.council) return json({ error: "sign in with the White Council" }, { status: 403 });
        return json({ feedback: await db.listConflictFeedback(env) });
      }
      const rejM = path.match(/^\/api\/conflicts\/(\d+)\/reject$/);
      if (rejM && request.method === "POST") {
        if (!session) return json({ error: "sign in with Discord" }, { status: 401 });
        if (!session.council) return json({ error: "only the White Council can reject a conflict" }, { status: 403 });
        const b = await request.json() as any;
        const reason = (b.reason || "").trim();
        if (!reason) return json({ error: "a reason is required" }, { status: 400 });
        const ok = await db.rejectConflict(env, +rejM[1], session.id, session.name, reason, !!session.test);
        if (!ok) return json({ error: "conflict not found or already actioned" }, { status: 404 });
        return json({ ok: true });
      }
      if (path === "/api/admin/reset-test" && request.method === "POST") {
        // Owner (Relim) or any REAL (non-test) approver can wipe test activity.
        const allowed = session && (session.id === env.OWNER_ID || (session.approver && !session.test));
        if (!allowed) return json({ error: "not allowed" }, { status: 403 });
        const r = await db.resetTestActivity(env);
        return json({ ok: true, ...r });
      }
      if (path === "/api/articles" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        return json({ articles: await db.listArticles(env, q), total: await db.articleCount(env) });
      }
      const artM = path.match(/^\/api\/articles\/([a-z0-9_]+)$/);
      if (artM && request.method === "GET") {
        const a = await db.getArticle(env, artM[1]);
        if (!a) return json({ error: "not found" }, { status: 404 });
        const open = await db.listProposals(env, ["submitted", "held"]);
        const state = await db.fileState(env, a.slug);
        // The text an editor should start from: the pending in-review version if one
        // exists (so edits merge), otherwise the live body.
        const editableBody = state.inReview && state.openAfter != null ? state.openAfter : a.body;
        return json({
          article: a,
          openProposals: open.filter((p) => p.slug === a.slug).map((p) => ({ id: p.id, status: p.status, author_name: p.author_name })),
          state: { queued: state.queued, inReview: state.inReview, openId: state.openId },
          editableBody,
          timestamps: { review_requested_at: state.reviewRequestedAt, approved_at: state.approvedAt, applied_at: state.appliedAt },
        });
      }

      if (path === "/api/proposals" && request.method === "POST") {
        if (!session) return json({ error: "sign in with Discord to propose" }, { status: 401 });
        if (!session.council) return json({ error: "only the White Council can propose edits" }, { status: 403 });
        const b = await request.json() as any;
        const a = await db.getArticle(env, b.slug);
        if (!a) return json({ error: "unknown article" }, { status: 400 });
        const state = await db.fileState(env, a.slug);
        if (state.queued) return json({ error: "This file is approved and in the queue for update — no further edits until the change is applied." }, { status: 409 });
        if (!b.rationale?.trim()) return json({ error: "a rationale is required" }, { status: 400 });
        // Merge: if this file already has an open review, new edits chain from the
        // pending version and supersede it, so there is one proposal to approve.
        const baseBody = state.inReview && state.openAfter != null ? state.openAfter : a.body;
        if (!b.body_after?.trim() || b.body_after === baseBody) return json({ error: "no change to the current text" }, { status: 400 });
        const now = Math.floor(Date.now() / 1000);
        const id = await db.createProposal(env, {
          slug: a.slug, author_id: session.id, author_name: session.name,
          kind: b.kind || "correction", rationale: b.rationale.trim(),
          body_before: baseBody, body_after: b.body_after, note_review: b.note_review?.trim() || null,
        });
        if (state.inReview) await db.supersedeOpen(env, a.slug, id);
        await db.touchArticle(env, a.slug, "review_requested_at", now);
        const checks = await runChecks(env, a, b.body_after);
        await db.saveChecks(env, id, checks.map((c) => ({ key: c.key, severity: c.severity, detail: `${c.label} — ${c.detail}` })));
        return json({ id, merged: state.inReview });
      }

      if (path === "/api/proposals" && request.method === "GET") {
        const status = url.searchParams.get("status");
        const statuses = status ? status.split(",") : ["submitted", "held", "approved", "applied", "superseded", "declined"];
        const props = await db.listProposals(env, statuses);
        return json({ proposals: props.map((p) => ({ id: p.id, slug: p.slug, kind: p.kind, status: p.status, author_name: p.author_name, updated_at: p.updated_at, decline_note: (p as any).decline_note ?? null, decline_by: (p as any).decline_by ?? null, decline_at: (p as any).decline_at ?? null })) });
      }
      const propM = path.match(/^\/api\/proposals\/(\d+)$/);
      if (propM && request.method === "GET") {
        const p = await db.getProposal(env, +propM[1]);
        if (!p) return json({ error: "not found" }, { status: 404 });
        const a = await db.getArticle(env, p.slug);
        return json({ proposal: p, article: a, checks: await db.getProposalChecks(env, p.id), decisions: await db.getDecisions(env, p.id) });
      }
      const decideM = path.match(/^\/api\/proposals\/(\d+)\/decide$/);
      if (decideM && request.method === "POST") {
        if (!session) return json({ error: "sign in with Discord" }, { status: 401 });
        const b = await request.json() as any;
        const verdict = b.verdict;
        if (["approve", "decline", "hold", "reopen", "apply"].includes(verdict) && !session.approver)
          return json({ error: "only an approver can decide" }, { status: 403 });
        await db.decide(env, +decideM[1], session.id, session.name, verdict, b.note?.trim() || null, !!session.test);
        return json({ ok: true });
      }

      // ---- frontend ----
      if (path === "/" || path === "/index.html") {
        return new Response(APP_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response("Not found", { status: 404 });
    } catch (e: any) {
      return json({ error: e?.message || "server error" }, { status: 500 });
    }
  },
};
