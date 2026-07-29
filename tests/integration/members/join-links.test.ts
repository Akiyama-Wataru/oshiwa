import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeJoinLinkRows } from "@/lib/members/join-links";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(),
}));

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const linkId = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const token = "a".repeat(64);
const idleState = { status: "idle", message: "", linkUrl: null } as const;

function createClient(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  const results: Record<string, { data: unknown; error: unknown }> = {
    create_group_join_link: {
      data: [{ link_id: linkId, link_token: token, expires_at: "2099-01-01" }],
      error: null,
    },
    revoke_group_join_link: { data: true, error: null },
    ...overrides,
  };
  const rpc = vi.fn(
    async (name: string) => results[name] ?? { data: null, error: null },
  );

  return { client: { rpc }, rpc };
}

function formData(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

async function loadActions() {
  return import("@/app/groups/[groupId]/members/join-links");
}

describe("normalizeJoinLinkRows", () => {
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: linkId,
      role: "member",
      expires_at: "2099-01-01T00:00:00+00:00",
      revoked_at: null,
      accepted_at: null,
      ...overrides,
    };
  }

  it("keeps only the links somebody could still walk through", () => {
    const entries = normalizeJoinLinkRows([
      row(),
      row({ accepted_at: "2026-07-29T00:00:00+00:00" }),
      row({ revoked_at: "2026-07-29T00:00:00+00:00" }),
      row({ expires_at: "2020-01-01T00:00:00+00:00" }),
    ]);

    expect(entries).toEqual([
      { id: linkId, role: "member", expiresAt: "2099-01-01T00:00:00+00:00" },
    ]);
  });

  it("drops rows it cannot read", () => {
    expect(
      normalizeJoinLinkRows([
        row({ id: "not-a-uuid" }),
        row({ role: "sovereign" }),
        row({ expires_at: "whenever" }),
        null,
      ]),
    ).toEqual([]);
    expect(normalizeJoinLinkRows(undefined)).toEqual([]);
  });
});

describe("join link actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://oshiwa.example.test");
  });

  describe("createJoinLinkAction", () => {
    it("asks for the chosen role and lifetime, and hands back a whole URL", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createJoinLinkAction } = await loadActions();

      const result = await createJoinLinkAction(
        idleState,
        formData({ groupId, role: "admin", lifetimeHours: "24" }),
      );

      expect(rpc).toHaveBeenCalledWith("create_group_join_link", {
        target_group_id: groupId,
        invited_role: "admin",
        expires_in: "24 hours",
      });
      expect(result.status).toBe("success");
      // The token exists nowhere else after this, so the URL has to be whole.
      expect(result.linkUrl).toBe(
        `https://oshiwa.example.test/invite/${token}`,
      );
    });

    it("refuses a lifetime the app does not offer without a database call", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createJoinLinkAction } = await loadActions();

      for (const lifetimeHours of ["999", "0", "abc"]) {
        expect(
          (
            await createJoinLinkAction(
              idleState,
              formData({ groupId, role: "member", lifetimeHours }),
            )
          ).status,
        ).toBe("error");
      }

      expect(rpc).not.toHaveBeenCalled();
    });

    it("never offers ownership through a link", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createJoinLinkAction } = await loadActions();

      const result = await createJoinLinkAction(
        idleState,
        formData({ groupId, role: "owner", lifetimeHours: "24" }),
      );

      expect(result.status).toBe("error");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("says it failed rather than handing back a link nobody can open", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { createJoinLinkAction } = await loadActions();

      const result = await createJoinLinkAction(
        idleState,
        formData({ groupId, role: "member", lifetimeHours: "24" }),
      );

      expect(result.status).toBe("error");
      expect(result.linkUrl).toBeNull();
      expect(rpc).not.toHaveBeenCalled();
    });

    it("hides why the database refused", async () => {
      mocks.createServerSupabaseClient.mockResolvedValue(
        createClient({
          create_group_join_link: {
            data: null,
            error: new Error("Group manager permission required"),
          },
        }).client,
      );
      const { createJoinLinkAction } = await loadActions();

      const result = await createJoinLinkAction(
        idleState,
        formData({ groupId, role: "member", lifetimeHours: "24" }),
      );

      expect(result.status).toBe("error");
      expect(result.message).not.toContain("permission");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("revokeJoinLinkAction", () => {
    it("closes the named link and refreshes the roster", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { revokeJoinLinkAction } = await loadActions();

      const result = await revokeJoinLinkAction(
        idleState,
        formData({ groupId, linkId }),
      );

      expect(rpc).toHaveBeenCalledWith("revoke_group_join_link", {
        target_link_id: linkId,
      });
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(
        `/groups/${groupId}/members`,
      );
    });

    it("treats an already settled link as an error", async () => {
      mocks.createServerSupabaseClient.mockResolvedValue(
        createClient({
          revoke_group_join_link: { data: false, error: null },
        }).client,
      );
      const { revokeJoinLinkAction } = await loadActions();

      expect(
        (await revokeJoinLinkAction(idleState, formData({ groupId, linkId })))
          .status,
      ).toBe("error");
    });
  });
});
