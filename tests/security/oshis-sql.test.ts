import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const supabaseRoot = join(repositoryRoot, "supabase");
const migrationsRoot = join(supabaseRoot, "migrations");
const invariantSqlPath = join(supabaseRoot, "tests", "oshis_rls.sql");
const storagePrivilegeNames = existsSync(migrationsRoot)
  ? readdirSync(migrationsRoot).filter((name) =>
      /^\d+_storage_policy_privileges\.sql$/.test(name),
    )
  : [];
const smokeScriptPath = join(supabaseRoot, "tests", "run-oshis-smoke.sh");

const migrationNames = existsSync(migrationsRoot)
  ? readdirSync(migrationsRoot).filter((name) =>
      /^\d+_oshis_media\.sql$/.test(name),
    )
  : [];
const migrationPath = join(
  migrationsRoot,
  migrationNames[0] ?? "missing_oshis_media.sql",
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
const storagePrivilegeSql = readIfPresent(
  join(
    migrationsRoot,
    storagePrivilegeNames[0] ?? "missing_storage_policy_privileges.sql",
  ),
);
const invariantSql = readIfPresent(invariantSqlPath);
const smokeScript = readIfPresent(smokeScriptPath);

const oshiTableSql =
  migrationSql.match(/create\s+table\s+public\.oshis\s*\([\s\S]*?\n\);/i)?.[0] ??
  "";

const expectedRpcNames = [
  "create_oshi",
  "delete_oshi",
  "reorder_oshis",
  "set_oshi_image",
  "update_oshi",
];

const createOshiSql = extractSqlFunction(migrationSql, "public.create_oshi");
const updateOshiSql = extractSqlFunction(migrationSql, "public.update_oshi");
const reorderOshisSql = extractSqlFunction(
  migrationSql,
  "public.reorder_oshis",
);
const setOshiImageSql = extractSqlFunction(
  migrationSql,
  "public.set_oshi_image",
);
const deleteOshiSql = extractSqlFunction(migrationSql, "public.delete_oshi");

describe("Supabase oshi and media SQL contract", () => {
  it("ships one migration, invariant SQL, and an executable smoke runner", () => {
    expect(migrationNames).toHaveLength(1);
    expect(existsSync(invariantSqlPath)).toBe(true);
    expect(
      existsSync(smokeScriptPath) &&
        (statSync(smokeScriptPath).mode & 0o111) !== 0,
    ).toBe(true);
  });

  it("keeps every oshi row inside one group and anchors the composite key", () => {
    expect(oshiTableSql).toMatch(
      /group_id\s+uuid\s+not\s+null\s+references\s+public\.groups\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i,
    );
    expect(oshiTableSql).toMatch(/unique\s*\(\s*group_id\s*,\s*id\s*\)/i);
    expect(migrationSql).toMatch(
      /alter\s+table\s+public\.oshis\s+enable\s+row\s+level\s+security/i,
    );
    expect(migrationSql).toMatch(
      /alter\s+table\s+public\.oshis\s+force\s+row\s+level\s+security/i,
    );
    expect(migrationSql).toMatch(
      /create\s+policy\s+oshis_select_members[\s\S]*for\s+select[\s\S]*using\s*\(\s*private\.is_group_member\s*\(\s*group_id\s*\)\s*\)/i,
    );
  });

  it("constrains the display name, member colour, and ordering", () => {
    expect(oshiTableSql).toMatch(
      /name\s+text\s+not\s+null[\s\S]*char_length[\s\S]*between\s+1\s+and\s+40/i,
    );
    expect(oshiTableSql).toMatch(
      /member_color\s+text\s+not\s+null[\s\S]*'\^#\[0-9a-f\]\{6\}\$'/i,
    );
    expect(oshiTableSql).toMatch(
      /sort_order\s+integer\s+not\s+null[\s\S]*sort_order\s*>=\s*0/i,
    );
    expect(migrationSql).toMatch(
      /add\s+constraint\s+oshis_group_sort_order_key\s+unique\s*\(\s*group_id\s*,\s*sort_order\s*\)\s+deferrable\s+initially\s+deferred/i,
    );
    expect(migrationSql).toMatch(
      /create\s+unique\s+index\s+oshis_group_name_idx[\s\S]*public\.oshis\s*\(\s*group_id\s*,\s*(?:pg_catalog\.)?lower\s*\(/i,
    );
  });

  it("pins each stored object to its own group and oshi prefix", () => {
    expect(oshiTableSql).toMatch(
      /image_path\s+text[\s\S]*jpg\|png\|webp/i,
    );
    expect(oshiTableSql).toMatch(
      /image_path\s+is\s+null\s+or[\s\S]*starts_with\s*\(\s*image_path\s*,[\s\S]*group_id[\s\S]*id/i,
    );
    expect(oshiTableSql).toMatch(/unique\s*\(\s*image_path\s*\)/i);
    expect(oshiTableSql).not.toMatch(/svg/i);
  });

  it("denies anonymous access and direct table DML for authenticated users", () => {
    expect(migrationSql).toMatch(
      /revoke\s+all\s+on\s+(?:table\s+)?public\.oshis\s+from\s+(?:public\s*,\s*)?anon\s*,\s*authenticated/i,
    );
    expect(migrationSql).toMatch(
      /grant\s+select\s+on\s+public\.oshis\s+to\s+authenticated/i,
    );
    expect(migrationSql).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|all)\b[^;]*\bto\s+(?:anon|authenticated)\b/i,
    );
  });

  it("hardens every new function and exposes exactly five mutation RPCs", () => {
    const publicFunctionNames = Array.from(
      migrationSql.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_]+)\s*\(/gi,
      ),
      (match) => match[1],
    ).sort();

    expect(publicFunctionNames).toEqual(expectedRpcNames);

    const hardenedFunctions = [
      "private.has_unsafe_display_characters",
      "private.oshi_image_group_id",
      "private.oshi_image_oshi_id",
      "private.can_manage_oshi",
      ...expectedRpcNames.map((name) => `public.${name}`),
    ];

    for (const qualifiedName of hardenedFunctions) {
      expect(extractSqlFunction(migrationSql, qualifiedName)).toMatch(
        /set\s+search_path\s*=\s*''/i,
      );
      expect(migrationSql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+${qualifiedName.replace(".", "\\.")}\\s*\\([^;]*\\)\\s+from\\s+public\\s*;`,
          "i",
        ),
      );
    }

    for (const rpcName of expectedRpcNames) {
      expect(extractSqlFunction(migrationSql, `public.${rpcName}`)).toMatch(
        /security\s+definer\s+set\s+search_path\s*=\s*''/i,
      );
      expect(migrationSql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${rpcName}\\s*\\([\\s\\S]*?\\)\\s+to\\s+authenticated`,
          "i",
        ),
      );
    }
  });

  it("serializes every mutation group-first and enforces the per-group quota", () => {
    for (const functionSql of [
      createOshiSql,
      updateOshiSql,
      reorderOshisSql,
      setOshiImageSql,
      deleteOshiSql,
    ]) {
      const groupLockIndex = functionSql.search(
        /from\s+public\.groups[\s\S]*?for\s+update/i,
      );
      const mutationIndex = functionSql.search(
        /(?:insert\s+into|update)\s+public\.oshis|delete\s+from\s+public\.oshis/i,
      );

      expect(groupLockIndex).toBeGreaterThanOrEqual(0);
      expect(mutationIndex).toBeGreaterThan(groupLockIndex);
    }

    expect(createOshiSql).toMatch(
      /count\s*\(\s*\*\s*\)[\s\S]*from\s+public\.oshis[\s\S]*>=\s*50/i,
    );
    expect(createOshiSql).toMatch(/private\.is_group_member/i);
    expect(reorderOshisSql).toMatch(
      /private\.has_group_role[\s\S]*'owner'[\s\S]*'admin'/i,
    );
  });

  it("restricts edits and deletion to the creator or a group manager", () => {
    const canManage = extractSqlFunction(
      migrationSql,
      "private.can_manage_oshi",
    );

    expect(canManage).toMatch(/created_by\s*=\s*\(\s*select\s+auth\.uid/i);
    // Authorship alone must never survive removal from the group.
    expect(canManage).toMatch(
      /private\.is_group_member\s*\(\s*oshi\.group_id\s*\)[\s\S]*created_by/i,
    );
    expect(canManage).toMatch(
      /private\.has_group_role[\s\S]*'owner'[\s\S]*'admin'/i,
    );

    for (const functionSql of [updateOshiSql, setOshiImageSql, deleteOshiSql]) {
      expect(functionSql).toMatch(/private\.can_manage_oshi/i);
    }
  });

  it("requires a complete permutation when reordering", () => {
    expect(reorderOshisSql).toMatch(/with\s+ordinality/i);
    expect(reorderOshisSql).toMatch(
      /count\s*\(\s*(?:distinct\s+)?[^)]*\)[\s\S]*ordered_ids/i,
    );
    expect(reorderOshisSql).toMatch(
      /raise\s+exception[\s\S]*(?:complete|permutation|every\s+oshi)/i,
    );
  });

  it("returns the replaced object path so orphaned files can be collected", () => {
    expect(setOshiImageSql).toMatch(/returns\s+text/i);
    expect(deleteOshiSql).toMatch(/returns\s+text/i);
    expect(setOshiImageSql).toMatch(
      /image_path\s+into\s+previous_image_path[\s\S]*for\s+update[\s\S]*update\s+public\.oshis/i,
    );
    // The whole group/oshi prefix is checked in the RPC, so a same-group path
    // for a different oshi is rejected with the sanitized error, not a raw
    // constraint violation.
    expect(setOshiImageSql).toMatch(
      /starts_with\s*\(\s*new_image_path[\s\S]*owning_group_id[\s\S]*target_oshi_id/i,
    );
    expect(setOshiImageSql).toMatch(/return\s+previous_image_path\s*;/i);
    expect(deleteOshiSql).toMatch(/returning\s+[\s\S]*image_path/i);
  });

  it("keeps the bucket private with a raster-only mime allow list", () => {
    expect(migrationSql).toMatch(
      /insert\s+into\s+storage\.buckets[\s\S]*'oshi-images'/i,
    );
    expect(migrationSql).toMatch(/public[\s\S]*false/i);
    expect(migrationSql).toMatch(/file_size_limit[\s\S]*1048576/i);
    expect(migrationSql).toMatch(
      /allowed_mime_types[\s\S]*'image\/jpeg'[\s\S]*'image\/png'[\s\S]*'image\/webp'/i,
    );
    expect(migrationSql).not.toMatch(/image\/svg/i);
  });

  it("scopes storage policies to group members and keeps objects immutable", () => {
    for (const [policy, command] of [
      ["oshi_images_select_members", "select"],
      ["oshi_images_insert_members", "insert"],
      ["oshi_images_delete_managers", "delete"],
    ] as const) {
      expect(migrationSql).toMatch(
        new RegExp(
          `create\\s+policy\\s+${policy}\\s+on\\s+storage\\.objects\\s+for\\s+${command}\\s+to\\s+authenticated`,
          "i",
        ),
      );
    }

    expect(migrationSql).toMatch(
      /create\s+policy\s+oshi_images_[\s\S]*bucket_id\s*=\s*'oshi-images'[\s\S]*private\.is_group_member\s*\(\s*private\.oshi_image_group_id\s*\(\s*name\s*\)\s*\)/i,
    );
    // An upload has to name an oshi row the caller may manage, so the bucket
    // cannot be used to park files nothing will ever reference.
    expect(migrationSql).toMatch(
      /create\s+policy\s+oshi_images_insert_members[\s\S]*private\.can_manage_oshi\s*\(\s*private\.oshi_image_oshi_id\s*\(\s*name\s*\)\s*\)/i,
    );
    expect(migrationSql).not.toMatch(
      /create\s+policy\s+[a-z_]*\s+on\s+storage\.objects\s+for\s+update/i,
    );
  });

  it("lets the owner of storage.objects reach the helpers its policies call", () => {
    // Row level security expressions are resolved against the table's owner,
    // and hosted Supabase gives storage.objects its own. Without these grants
    // every upload fails with "permission denied for schema private".
    expect(storagePrivilegeNames).toHaveLength(1);
    expect(storagePrivilegeSql).toMatch(
      /grant\s+usage\s+on\s+schema\s+private\s+to\s+supabase_storage_admin/i,
    );

    for (const helper of [
      "private\\.is_group_member\\(uuid\\)",
      "private\\.oshi_image_group_id\\(text\\)",
      "private\\.oshi_image_oshi_id\\(text\\)",
      "private\\.can_manage_oshi\\(uuid\\)",
    ]) {
      expect(storagePrivilegeSql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+${helper}[\\s\\S]{0,80}to\\s+supabase_storage_admin`,
          "i",
        ),
      );
    }

    // The grant must be skipped where that role does not exist, so the
    // throwaway cluster the smoke script builds can still apply the migration.
    expect(storagePrivilegeSql).toMatch(
      /pg_catalog\.pg_roles[\s\S]*supabase_storage_admin/i,
    );
    expect(storagePrivilegeSql).not.toMatch(
      /grant[^;]*on\s+all\s+functions\s+in\s+schema\s+private/i,
    );
  });

  it("includes executable invariants for the phase three pass conditions", () => {
    for (const invariant of [
      /set\s+role\s+anon/i,
      /set\s+role\s+authenticated/i,
      /direct table DML/i,
      /cross-group oshi read/i,
      /cross-group oshi mutation/i,
      /cross-group image path/i,
      /removed member cannot manage/i,
      /svg rejection/i,
      /oversized image rejection/i,
      /per-group quota/i,
      /member cannot reorder/i,
      /non-owner cannot delete/i,
      /orphan cleanup path/i,
      /storage policy privileges/i,
      /storage cross-group/i,
      /storage object immutability/i,
      /\brollback\s*;/i,
    ]) {
      expect(invariantSql).toMatch(invariant);
    }

    expect(smokeScript).toMatch(/mktemp\s+-d/i);
    expect(smokeScript).toMatch(/initdb/i);
    expect(smokeScript).toMatch(/pg_ctl/i);
    expect(smokeScript).toMatch(/auth_groups\.sql/i);
    expect(smokeScript).toMatch(/oshis_media\.sql/i);
    expect(smokeScript).toMatch(/storage_policy_privileges\.sql/i);
    // The harness has to mirror the hosted ownership of storage.objects,
    // otherwise the privilege assertions above would have nothing to check.
    expect(smokeScript).toMatch(/create\s+role\s+supabase_storage_admin/i);
    expect(smokeScript).toMatch(
      /alter\s+table\s+storage\.objects\s+owner\s+to\s+supabase_storage_admin/i,
    );
    expect(smokeScript).toMatch(/oshis_rls\.sql/i);
    expect(smokeScript).toMatch(/trap\s+cleanup/i);
  });
});
