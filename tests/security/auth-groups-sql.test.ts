import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const supabaseRoot = join(repositoryRoot, "supabase");
const migrationsRoot = join(supabaseRoot, "migrations");
const configPath = join(supabaseRoot, "config.toml");
const invariantSqlPath = join(
  supabaseRoot,
  "tests",
  "auth_groups_rls.sql",
);
const smokeScriptPath = join(
  supabaseRoot,
  "tests",
  "run-auth-groups-smoke.sh",
);

const migrationNames = existsSync(migrationsRoot)
  ? readdirSync(migrationsRoot).filter((name) =>
      /^\d+_auth_groups\.sql$/.test(name),
    )
  : [];
const migrationPath = join(
  migrationsRoot,
  migrationNames[0] ?? "missing_auth_groups.sql",
);

function readIfPresent(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function extractSqlFunction(sql: string, qualifiedName: string) {
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    sql.match(
      new RegExp(
        `create\\s+(?:or\\s+replace\\s+)?function\\s+${escapedName}\\s*\\([\\s\\S]*?\\n\\$function\\$;`,
        "i",
      ),
    )?.[0] ?? ""
  );
}

const migrationSql = readIfPresent(migrationPath);
const invitationTableSql =
  migrationSql.match(
    /create\s+table\s+public\.invitations\s*\([\s\S]*?\n\);/i,
  )?.[0] ?? "";
const changeMemberRoleFunctionSql = extractSqlFunction(
  migrationSql,
  "public.change_member_role",
);
const createGroupFunctionSql = extractSqlFunction(
  migrationSql,
  "public.create_group",
);
const createInvitationFunctionSql = extractSqlFunction(
  migrationSql,
  "public.create_invitation",
);
const acceptInvitationFunctionSql = extractSqlFunction(
  migrationSql,
  "public.accept_invitation",
);
const removeMemberFunctionSql = extractSqlFunction(
  migrationSql,
  "public.remove_member",
);
const markDeliveryFailedFunctionSql = extractSqlFunction(
  migrationSql,
  "public.mark_invitation_delivery_failed",
);
const configToml = readIfPresent(configPath);
const invariantSql = readIfPresent(invariantSqlPath);
const smokeScript = readIfPresent(smokeScriptPath);

const expectedRpcNames = [
  "accept_invitation",
  "change_member_role",
  "create_group",
  "create_invitation",
  "mark_invitation_delivery_failed",
  "remove_member",
  "revoke_invitation",
];

describe("Supabase auth and group SQL contract", () => {
  it("ships one migration, local config, invariant SQL, and executable smoke runner", () => {
    expect(migrationNames).toHaveLength(1);
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(invariantSqlPath)).toBe(true);
    expect(existsSync(smokeScriptPath)).toBe(true);
    expect(
      existsSync(smokeScriptPath) &&
        (statSync(smokeScriptPath).mode & 0o111) !== 0,
    ).toBe(true);
  });

  it("pins a local Supabase project to PostgreSQL 17 and exposes only public APIs", () => {
    expect(configToml).toMatch(/project_id\s*=\s*"oshikatu"/i);
    expect(configToml).toMatch(/\[api\][\s\S]*schemas\s*=\s*\["public"\]/i);
    expect(configToml).not.toMatch(/schemas\s*=\s*\[[^\]]*"private"/i);
    // Supabase hosts PostgreSQL 15 and 17; 16 was never an option and the CLI
    // refuses to read a config that names it.
    expect(configToml).toMatch(
      /\[db\][\s\S]*major_version\s*=\s*17\b/i,
    );
  });

  it("defines the four RLS-protected domain tables and constrained roles", () => {
    expect(migrationSql).toMatch(
      /create\s+type\s+public\.membership_role\s+as\s+enum\s*\(\s*'owner'\s*,\s*'admin'\s*,\s*'member'\s*\)/i,
    );

    for (const table of [
      "profiles",
      "groups",
      "memberships",
      "invitations",
    ]) {
      expect(migrationSql).toMatch(
        new RegExp(`create\\s+table\\s+public\\.${table}\\b`, "i"),
      );
      expect(migrationSql).toMatch(
        new RegExp(
          `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
          "i",
        ),
      );
      expect(migrationSql).toMatch(
        new RegExp(
          `alter\\s+table\\s+public\\.${table}\\s+force\\s+row\\s+level\\s+security`,
          "i",
        ),
      );
    }

    expect(migrationSql).toMatch(
      /create\s+table\s+public\.memberships[\s\S]*primary\s+key\s*\(\s*group_id\s*,\s*user_id\s*\)/i,
    );
    expect(migrationSql).toMatch(
      /create\s+table\s+public\.invitations[\s\S]*email_normalized\s+text\s+not\s+null[\s\S]*token_hash\s+bytea\s+not\s+null[\s\S]*expires_at\s+timestamptz\s+not\s+null[\s\S]*revoked_at\s+timestamptz[\s\S]*accepted_at\s+timestamptz[\s\S]*delivery_state\s+public\.invitation_delivery_state/i,
    );
  });

  it("denies anonymous access and denies authenticated users direct table DML", () => {
    expect(migrationSql).toMatch(
      /revoke\s+all\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+anon\s*,\s*authenticated/i,
    );
    expect(migrationSql).toMatch(
      /grant\s+select\s+on\s+public\.(profiles|groups|memberships|invitations)[\s\S]*to\s+authenticated/i,
    );
    expect(migrationSql).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|all)\b[^;]*\bto\s+(?:anon|authenticated)\b/i,
    );
    expect(migrationSql).not.toMatch(
      /grant\s+(?:select|insert|update|delete|execute)\b[^;]*\bto\s+anon\b/i,
    );
  });

  it("hardens every SECURITY DEFINER function and removes PUBLIC execution", () => {
    const definerFunctions = [
      "private.current_verified_email",
      "private.is_group_member",
      "private.has_group_role",
      "private.can_view_profile",
      "private.handle_new_user",
      ...expectedRpcNames.map((name) => `public.${name}`),
    ];

    for (const qualifiedName of definerFunctions) {
      expect(extractSqlFunction(migrationSql, qualifiedName)).toMatch(
        /security\s+definer\s+set\s+search_path\s*=\s*''/i,
      );
      expect(migrationSql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+${qualifiedName.replace(".", "\\.")}\\s*\\([^;]*\\)\\s+from\\s+public\\s*;`,
          "i",
        ),
      );
    }

    expect(migrationSql).toMatch(
      /revoke\s+all\s+on\s+schema\s+private\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
  });

  it("exposes exactly the seven narrow authenticated mutation RPCs", () => {
    const publicFunctionNames = Array.from(
      migrationSql.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_]+)\s*\(/gi,
      ),
      (match) => match[1],
    ).sort();

    expect(publicFunctionNames).toEqual(expectedRpcNames);

    for (const rpcName of expectedRpcNames) {
      expect(migrationSql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${rpcName}\\s*\\([\\s\\S]*?\\)\\s+to\\s+authenticated`,
          "i",
        ),
      );
    }
  });

  it("stores only a SHA-256 token hash and accepts a verified-email-matched token once", () => {
    expect(migrationSql).toMatch(
      /extensions\.gen_random_bytes\s*\(\s*32\s*\)/i,
    );
    expect(migrationSql).toMatch(
      /extensions\.digest\s*\([\s\S]*'sha256'\s*\)/i,
    );
    expect(invitationTableSql).not.toMatch(
      /\b(?:raw_)?token\s+text\b/i,
    );
    expect(migrationSql).toMatch(
      /function\s+public\.accept_invitation\s*\(\s*invite_token\s+text\s*\)/i,
    );
    expect(migrationSql).toMatch(
      /from\s+auth\.users[\s\S]*email_confirmed_at\s+is\s+not\s+null/i,
    );
    expect(migrationSql).toMatch(
      /from\s+public\.invitations[\s\S]*for\s+(?:no\s+key\s+)?update/i,
    );
    expect(migrationSql).toMatch(
      /accepted_at\s+is\s+null[\s\S]*revoked_at\s+is\s+null[\s\S]*expires_at\s*>\s*(?:pg_catalog\.)?(?:statement_timestamp|clock_timestamp)\s*\(\s*\)/i,
    );
  });

  it("allows only the invitation creator-manager to record pending delivery failure", () => {
    expect(markDeliveryFailedFunctionSql).toMatch(
      /function\s+public\.mark_invitation_delivery_failed\s*\(\s*invitation_id\s+uuid\s*\)/i,
    );
    expect(markDeliveryFailedFunctionSql).toMatch(
      /invitation\.invited_by\s*=\s*actor_id/i,
    );
    expect(markDeliveryFailedFunctionSql).toMatch(
      /private\.has_group_role[\s\S]*'owner'[\s\S]*'admin'/i,
    );
    expect(markDeliveryFailedFunctionSql).toMatch(
      /delivery_state\s*=\s*'pending'[\s\S]*accepted_at\s+is\s+null[\s\S]*revoked_at\s+is\s+null/i,
    );
    expect(markDeliveryFailedFunctionSql).toMatch(
      /set[\s\S]*delivery_state\s*=\s*'failed'/i,
    );
    expect(markDeliveryFailedFunctionSql).not.toMatch(
      /delivery_state\s*=\s*'sent'/i,
    );
  });

  it("serializes invitation authority group-first and invalidates deauthorized issuers", () => {
    const createGroupLockIndex = createInvitationFunctionSql.search(
      /from\s+public\.groups[\s\S]*for\s+update/i,
    );
    const createRoleCheckIndex = createInvitationFunctionSql.search(
      /private\.has_group_role/i,
    );
    const acceptGroupLockIndex = acceptInvitationFunctionSql.search(
      /from\s+public\.groups[\s\S]*for\s+update/i,
    );
    const acceptInvitationLockIndex = acceptInvitationFunctionSql.search(
      /select\s+invitation\.\*[\s\S]*?from\s+public\.invitations[\s\S]*?for\s+update/i,
    );

    expect(createGroupLockIndex).toBeGreaterThanOrEqual(0);
    expect(createRoleCheckIndex).toBeGreaterThan(createGroupLockIndex);
    expect(acceptGroupLockIndex).toBeGreaterThanOrEqual(0);
    expect(acceptInvitationLockIndex).toBeGreaterThan(
      acceptGroupLockIndex,
    );
    expect(acceptInvitationFunctionSql).toMatch(
      /invited_by[\s\S]*public\.memberships[\s\S]*role\s+in\s*\(\s*'owner'\s*,\s*'admin'\s*\)/i,
    );
    expect(changeMemberRoleFunctionSql).toMatch(
      /update\s+public\.invitations[\s\S]*invited_by\s*=\s*member_user_id[\s\S]*revoked_at\s+is\s+null[\s\S]*accepted_at\s+is\s+null/i,
    );
    expect(removeMemberFunctionSql).toMatch(
      /update\s+public\.invitations[\s\S]*invited_by\s*=\s*member_user_id[\s\S]*revoked_at\s+is\s+null[\s\S]*accepted_at\s+is\s+null/i,
    );
  });

  it("makes acceptance idempotent only for the same accepted member", () => {
    expect(acceptInvitationFunctionSql).toMatch(
      /accepted_by\s*=\s*actor_id[\s\S]*from\s+public\.memberships[\s\S]*user_id\s*=\s*actor_id[\s\S]*return\s+locked_invitation\.group_id/i,
    );
    expect(invariantSql).toMatch(/same-actor retry/i);
    expect(invariantSql).toMatch(/other-actor replay/i);
  });

  it("enforces locked group and invitation creation quotas", () => {
    expect(migrationSql).toMatch(
      /create\s+index\s+groups_created_by_idx[\s\S]*public\.groups\s*\(\s*created_by/i,
    );
    expect(migrationSql).toMatch(
      /create\s+index\s+invitations_invited_by_created_at_idx[\s\S]*public\.invitations\s*\(\s*invited_by\s*,\s*created_at/i,
    );
    expect(createGroupFunctionSql).toMatch(
      /from\s+public\.profiles[\s\S]*for\s+update[\s\S]*count\s*\(\s*\*\s*\)[\s\S]*>=\s*20/i,
    );
    expect(createInvitationFunctionSql).toMatch(
      /created_at\s*>[\s\S]*interval\s+'1 hour'[\s\S]*>=\s*20/i,
    );
    expect(createInvitationFunctionSql).toMatch(
      /delivery_state[\s\S]*accepted_at\s+is\s+null[\s\S]*revoked_at\s+is\s+null[\s\S]*expires_at[\s\S]*>=\s*100/i,
    );
    expect(invariantSql).toMatch(/group creation quota/i);
    expect(invariantSql).toMatch(/hourly invitation quota/i);
    expect(invariantSql).toMatch(/live pending invitation quota/i);
  });

  it("serializes membership mutations and protects the last owner", () => {
    expect(migrationSql).toMatch(
      /function\s+public\.change_member_role[\s\S]*from\s+public\.groups[\s\S]*for\s+update[\s\S]*role\s*=\s*'owner'[\s\S]*count\s*\(\s*\*\s*\)[\s\S]*last owner/i,
    );
    expect(migrationSql).toMatch(
      /function\s+public\.remove_member[\s\S]*from\s+public\.groups[\s\S]*for\s+update[\s\S]*role\s*=\s*'owner'[\s\S]*count\s*\(\s*\*\s*\)[\s\S]*last owner/i,
    );
  });

  it("shares profiles only across a common group without recursive RLS", () => {
    expect(migrationSql).toMatch(
      /function\s+private\.can_view_profile\s*\(\s*target_user_id\s+uuid\s*\)[\s\S]*from\s+public\.memberships[\s\S]*join\s+public\.memberships[\s\S]*auth\.uid\s*\(\s*\)/i,
    );
    expect(migrationSql).toMatch(
      /create\s+policy\s+profiles_select_shared_group[\s\S]*using\s*\([\s\S]*id\s*=\s*\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)[\s\S]*private\.can_view_profile\s*\(\s*id\s*\)/i,
    );
  });

  it("authorizes remove_member before looking up the target membership", () => {
    const groupLockIndex = removeMemberFunctionSql.search(
      /perform\s+1[\s\S]*?from\s+public\.groups[\s\S]*?for\s+update/i,
    );
    const targetLookupIndex = removeMemberFunctionSql.search(
      /select\s+membership\.role\s+into\s+removed_role/i,
    );
    const authorizationIndexes = Array.from(
      removeMemberFunctionSql.matchAll(
        /if\s+actor_role\s+is\s+null/gi,
      ),
      (match) => match.index,
    );

    expect(groupLockIndex).toBeGreaterThanOrEqual(0);
    expect(authorizationIndexes).toHaveLength(2);
    expect(authorizationIndexes[0]).toBeLessThan(groupLockIndex);
    expect(authorizationIndexes[1]).toBeGreaterThan(groupLockIndex);
    expect(targetLookupIndex).toBeGreaterThan(authorizationIndexes[1]);
  });

  it("does not reveal group existence before change_member_role authorization", () => {
    const groupLockIndex = changeMemberRoleFunctionSql.search(
      /perform\s+1[\s\S]*?from\s+public\.groups[\s\S]*?for\s+update/i,
    );
    const targetLookupIndex = changeMemberRoleFunctionSql.search(
      /select\s+membership\.role\s+into\s+previous_role/i,
    );
    const authorizationIndexes = Array.from(
      changeMemberRoleFunctionSql.matchAll(
        /if\s+actor_role\s+is\s+distinct\s+from\s+'owner'/gi,
      ),
      (match) => match.index,
    );

    expect(groupLockIndex).toBeGreaterThanOrEqual(0);
    expect(authorizationIndexes).toHaveLength(2);
    expect(authorizationIndexes[0]).toBeLessThan(groupLockIndex);
    expect(authorizationIndexes[1]).toBeGreaterThan(groupLockIndex);
    expect(targetLookupIndex).toBeGreaterThan(authorizationIndexes[1]);
  });

  it("documents the tenant-safe composite foreign-key rule for future group data", () => {
    expect(migrationSql).toMatch(
      /future[\s\S]*group-owned[\s\S]*foreign\s+key\s*\(\s*group_id\s*,[\s\S]*references[\s\S]*\(\s*group_id\s*,\s*id\s*\)/i,
    );
  });

  it("includes executable invariants for RLS, token secrecy, one-time use, and last-owner safety", () => {
    expect(invariantSql).toMatch(/set\s+role\s+anon/i);
    expect(invariantSql).toMatch(/set\s+role\s+authenticated/i);
    expect(invariantSql).toMatch(/direct table DML/i);
    expect(invariantSql).toMatch(/token_hash/i);
    expect(invariantSql).toMatch(/accepted_at/i);
    expect(invariantSql).toMatch(/last owner/i);
    expect(invariantSql).toMatch(/shared-group profile/i);
    expect(invariantSql).toMatch(/unrelated profile/i);
    expect(invariantSql).toMatch(/cross-group/i);
    expect(invariantSql).toMatch(/delivery_state direct update/i);
    expect(invariantSql).toMatch(/service_role delivery_state update/i);
    expect(invariantSql).toMatch(/delivery failure RPC/i);
    expect(invariantSql).toMatch(/cross-group delivery failure/i);
    expect(invariantSql).toMatch(/revoked invitation delivery failure/i);
    expect(invariantSql).toMatch(/accepted invitation delivery failure/i);
    expect(invariantSql).toMatch(/membership-probing side channel/i);
    expect(invariantSql).toMatch(/role-change group-probing side channel/i);
    expect(invariantSql).toMatch(/role-boundary escalation/i);
    expect(invariantSql).toMatch(/issuer revocation/i);
    expect(invariantSql).toMatch(/\brollback\s*;/i);

    expect(smokeScript).toMatch(/mktemp\s+-d/i);
    expect(smokeScript).toMatch(/initdb/i);
    expect(smokeScript).toMatch(/pg_ctl/i);
    expect(smokeScript).toMatch(/auth_groups_rls\.sql/i);
    expect(smokeScript).toMatch(/concurrent_accept/i);
    expect(smokeScript).toMatch(/accept_first_pid/i);
    expect(smokeScript).toMatch(/accept_second_pid/i);
    expect(smokeScript).toMatch(/successful_accepts/i);
    expect(smokeScript).toMatch(/concurrent_rejected_user_id/i);
    expect(smokeScript).toMatch(/trap\s+cleanup/i);
  });
});
