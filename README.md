# Scriptorium

MUME help-file audit, edit-proposal and approval tool. Cloudflare Worker + D1.

**Live:** https://scriptorium.mume-idea-submission.workers.dev

## What it does
- **Browse** all 562 MUME help files (searchable), open any one.
- **Propose an edit** (White Council only) with a required rationale; before/after
  tracked to your Discord identity.
- **Automated checks** run on each proposal (See-Also links resolve, field block
  preserved, size sanity).
- **Review queue** — an approver Approves / Declines / Holds.
- On approval, a **clean, copy-paste-ready block** in help-file format. It never
  writes to the game — a human applies the output.

## Layout
```
scripts/crawl.mjs   crawl mume.org/help -> scripts/out/articles.jsonl
scripts/seed.mjs    load articles.jsonl into remote D1
migrations/         D1 schema
src/                Worker: index (router), db, discord (OAuth), session, checks
public/app.html     single-page frontend (bundled as text)
wrangler.toml       Worker + D1 + Discord config (White Council account)
```

## Ops
```bash
wrangler whoami                 # must be themumewhitecouncil@gmail.com
node scripts/crawl.mjs          # re-crawl the corpus
node scripts/seed.mjs           # re-seed D1
npx wrangler deploy             # ship
```

## Two setup steps to enable Discord login
1. In the Discord Developer Portal, on the **Idea Board** app (id `1526294757733695619`)
   → **OAuth2** → add redirect: `https://scriptorium.mume-idea-submission.workers.dev/auth/callback`
2. Set the approver allowlist to Jahara's Discord user id:
   `wrangler secret put APPROVER_IDS` (or edit `wrangler.toml` vars) — comma-separated ids.
   Until set, any White Council member can approve.

Secrets already set: `DISCORD_CLIENT_SECRET` (reused from the Idea Board app),
`SESSION_SIGNING_KEY`.

## Not yet built
The full conflict-detection check engine (field block vs SPELL LIST, cross-corpus
numeric contradictions), the news-announcement poller/matcher, the weekly re-crawl
cron, and the Admin area. See `~/Downloads/scriptorium_spec.md` for the full spec.
