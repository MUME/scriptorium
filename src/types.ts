export interface Env {
  DB: D1Database;
  PUBLIC_BASE_URL: string;
  // Discord OAuth (reuses the Idea Board app). Secrets set via `wrangler secret put`.
  DISCORD_APP_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_GUILD_ID?: string;
  COUNCIL_ROLE_ID?: string;
  APPROVER_IDS?: string; // comma-separated Discord user ids allowed to approve
  TEST_APPROVER_IDS?: string; // ids that act as reversible TEST reviewers
  OWNER_ID?: string; // single Discord id allowed to read the login log (Relim)
  SESSION_SIGNING_KEY?: string;
}

export interface Article {
  slug: string;
  title: string;
  aliases: string[];
  field_block: string | null;
  body: string;
  body_hash: string;
  links: string[];
  status: string;
  first_seen: number;
  last_seen: number;
}

export interface Proposal {
  id: number;
  slug: string;
  author_id: string;
  author_name: string;
  kind: string;
  rationale: string;
  body_before: string;
  body_after: string;
  note_review: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface Session {
  id: string;      // discord user id
  name: string;    // username
  council: boolean; // holds the White Council role
  approver: boolean; // on the approver allowlist
  test?: boolean;  // a reversible TEST reviewer (all actions tagged is_test)
}
