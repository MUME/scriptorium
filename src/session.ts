import type { Env, Session } from "./types";

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as any))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDec = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function key(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SIGNING_KEY || "dev-only-key"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

// Signed session token: base64url(payload).base64url(hmac), with an 8h expiry.
export async function makeSession(env: Env, s: Session): Promise<string> {
  const payload = JSON.stringify({ ...s, exp: Math.floor(Date.now() / 1000) + 8 * 3600 });
  const body = b64u(enc.encode(payload));
  const sig = b64u(await crypto.subtle.sign("HMAC", await key(env), enc.encode(body)));
  return `${body}.${sig}`;
}

export async function readSession(env: Env, cookie: string | null): Promise<Session | null> {
  if (!cookie) return null;
  const m = cookie.match(/scr_session=([^;]+)/);
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(env), b64uDec(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64uDec(body)));
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: p.id, name: p.name, council: !!p.council, approver: !!p.approver, test: !!p.test };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  return `scr_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${8 * 3600}`;
}
export const clearCookie = "scr_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
export function stateCookie(state: string): string {
  return `scr_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
}
