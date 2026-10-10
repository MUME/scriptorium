import type { Env, Session } from "./types";

const API = "https://discord.com/api/v10";

export function authorizeUrl(env: Env, state: string): string {
  const p = new URLSearchParams({
    client_id: env.DISCORD_APP_ID || "",
    response_type: "code",
    redirect_uri: `${env.PUBLIC_BASE_URL}/auth/callback`,
    scope: "identify guilds.members.read",
    state,
    prompt: "none",
  });
  return `https://discord.com/oauth2/authorize?${p}`;
}

// Exchange the code, read identity + guild-member roles, return a Session.
// Returns null if the user is not in the guild.
export async function completeLogin(env: Env, code: string): Promise<Session | null> {
  const tok = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_APP_ID || "",
      client_secret: env.DISCORD_CLIENT_SECRET || "",
      grant_type: "authorization_code",
      code,
      redirect_uri: `${env.PUBLIC_BASE_URL}/auth/callback`,
    }),
  }).then((r) => r.json() as any);
  if (!tok.access_token) return null;

  const auth = { Authorization: `Bearer ${tok.access_token}` };
  const me = await fetch(`${API}/users/@me`, { headers: auth }).then((r) => r.json() as any);
  const member = await fetch(`${API}/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, { headers: auth });
  if (member.status === 404) return null; // not in the guild
  const mem = await member.json() as any;
  const roles: string[] = mem.roles || [];

  const realCouncil = !!env.COUNCIL_ROLE_ID && roles.includes(env.COUNCIL_ROLE_ID);
  const approvers = (env.APPROVER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const testers = (env.TEST_APPROVER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const test = testers.includes(me.id);
  // Test reviewers get the full council + approver toolkit so they can exercise the
  // whole flow (propose, decide, reject); everything they do is tagged is_test and
  // is reversible via "Undo test activity". Real approver = on the allowlist, or (until
  // it's set) any Council member.
  const council = realCouncil || test;
  const approver = test || (approvers.length ? approvers.includes(me.id) : realCouncil);
  return { id: me.id, name: me.global_name || me.username, council, approver, test };
}
