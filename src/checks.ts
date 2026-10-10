import type { Env, Article } from "./types";
import { allSlugsAndAliases } from "./db";

export interface Check { key: string; severity: "ok" | "warn" | "error"; label: string; detail: string; }

// Run the automated checks against a proposed body. Extensible — more checks
// (field-block value vs SPELL LIST, numeric contradictions across the corpus)
// slot in here as the fact table lands.
export async function runChecks(env: Env, article: Article, bodyAfter: string): Promise<Check[]> {
  const checks: Check[] = [];
  const before = article.body;

  // C4 — every "help <topic>" / See-Also slug referenced resolves to a real article.
  const known = await allSlugsAndAliases(env);
  const refs = new Set<string>();
  for (const m of bodyAfter.matchAll(/\bhelp\s+([a-z][a-z0-9_]{1,40})/gi)) refs.add(m[1].toLowerCase());
  const seeAlso = bodyAfter.match(/see also:\s*([^\n]+)/i);
  if (seeAlso) for (const t of seeAlso[1].split(/[,\s]+/)) { const s = t.trim().toLowerCase(); if (s) refs.add(s); }
  const unresolved = [...refs].filter((r) => !known.has(r) && !known.has(r.replace(/s$/, "")));
  checks.push(unresolved.length
    ? { key: "C4", severity: "error", label: "A referenced topic does not resolve", detail: unresolved.slice(0, 5).join(", ") }
    : { key: "C4", severity: "ok", label: "All referenced topics resolve", detail: `${refs.size} checked` });

  // C2 — a field block, if the article has one, is preserved and well-formed.
  const hadFields = !!article.field_block || /^\s*Syntax\s*:/m.test(before);
  if (hadFields) {
    const keepsFields = /^\s*\w[\w. ]*\s*:\s+\S/m.test(bodyAfter) && /Syntax\s*:/i.test(bodyAfter);
    checks.push(keepsFields
      ? { key: "C2", severity: "ok", label: "Field block preserved", detail: "structured header intact" }
      : { key: "C2", severity: "warn", label: "Field block may be missing", detail: "the original had a Syntax field block" });
  }

  // Sanity — flag a large unexplained deletion.
  const shrink = 1 - bodyAfter.length / Math.max(before.length, 1);
  if (shrink > 0.6) checks.push({ key: "S1", severity: "warn", label: "Large reduction in length", detail: `${Math.round(shrink * 100)}% shorter than the current text` });
  else checks.push({ key: "S1", severity: "ok", label: "No unusual size change", detail: `${bodyAfter.length} chars` });

  return checks;
}
