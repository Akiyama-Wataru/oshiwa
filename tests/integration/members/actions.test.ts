import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(),
}));

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const memberId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const viewerId = "1f0f2b1c-4b6f-4a3d-9d0e-2b6f1a2c3d4e";
const invitationId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const membersPath = `/groups/${groupId}/members`;
const idleState = { status: "idle", message: "" } as const;

function createClient(
  options: {
    data?: unknown;
    error?: unknown;
    user?: { id: string } | null;
  } = {},
) {
  const rpc = vi.fn().mockResolvedValue({
    data: options.data === undefined ? true : options.data,
    error: options.error ?? null,
  });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: options.user === undefined ? { id: viewerId } : options.user },
    error: options.user === null ? new Error("no session") : null,
  });

  return { client: { rpc, auth: { getUser } }, rpc };
}

function formData(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

async function loadActions() {
  return import("@/app/groups/[groupId]/members/actions");
}

describe("member management actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("changeMemberRoleAction", () => {
    it("forwards the group, the member and the new role", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { changeMemberRoleAction } = await loadActions();

      const result = await changeMemberRoleAction(
        idleState,
        formData({ groupId, userId: memberId, role: "admin" }),
      );

      expect(rpc).toHaveBeenCalledWith("change_member_role", {
        target_group_id: groupId,
        member_user_id: memberId,
        new_role: "admin",
      });
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(membersPath);
    });

    it("refuses a role the app does not offer without a database call", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { changeMemberRoleAction } = await loadActions();

      for (const role of ["sovereign", "", "OWNER"]) {
        expect(
          (
            await changeMemberRoleAction(
              idleState,
              formData({ groupId, userId: memberId, role }),
            )
          ).status,
        ).toBe("error");
      }

      expect(rpc).not.toHaveBeenCalled();
    });

    it("treats a refusal as an error without revalidating", async () => {
      const { client } = createClient({ data: false });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { changeMemberRoleAction } = await loadActions();

      const result = await changeMemberRoleAction(
        idleState,
        formData({ groupId, userId: memberId, role: "member" }),
      );

      expect(result.status).toBe("error");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    it("explains the last owner rule without echoing the database", async () => {
      const { client } = createClient({
        data: null,
        error: new Error("Cannot demote the last owner"),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { changeMemberRoleAction } = await loadActions();

      const result = await changeMemberRoleAction(
        idleState,
        formData({ groupId, userId: memberId, role: "member" }),
      );

      expect(result.status).toBe("error");
      expect(result.message).toContain("オーナー");
      expect(result.message).not.toContain("Cannot demote");
    });
  });

  describe("removeMemberAction", () => {
    it("removes the named member and refreshes the roster", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { removeMemberAction } = await loadActions();

      const result = await removeMemberAction(
        idleState,
        formData({ groupId, userId: memberId }),
      );

      expect(rpc).toHaveBeenCalledWith("remove_member", {
        target_group_id: groupId,
        member_user_id: memberId,
      });
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(membersPath);
    });

    it("hides why the database refused", async () => {
      const { client } = createClient({
        data: null,
        error: new Error("Membership removal permission required"),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { removeMemberAction } = await loadActions();

      const result = await removeMemberAction(
        idleState,
        formData({ groupId, userId: memberId }),
      );

      expect(result.status).toBe("error");
      expect(result.message).not.toContain("permission required");
    });
  });

  describe("leaveGroupAction", () => {
    it("takes the member id from the session rather than the form", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { leaveGroupAction } = await loadActions();

      // A userId in the form would let one member post another member out.
      await expect(
        leaveGroupAction(
          idleState,
          formData({ groupId, userId: memberId }),
        ),
      ).rejects.toThrow("REDIRECT:/groups");

      expect(rpc).toHaveBeenCalledWith("remove_member", {
        target_group_id: groupId,
        member_user_id: viewerId,
      });
    });

    it("refuses to leave without a session", async () => {
      const { client, rpc } = createClient({ user: null });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { leaveGroupAction } = await loadActions();

      const result = await leaveGroupAction(idleState, formData({ groupId }));

      expect(result.status).toBe("error");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("stays on the page when the last owner cannot leave", async () => {
      const { client } = createClient({
        data: null,
        error: new Error("Cannot remove the last owner"),
      });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { leaveGroupAction } = await loadActions();

      const result = await leaveGroupAction(idleState, formData({ groupId }));

      expect(result.status).toBe("error");
      expect(result.message).toContain("オーナー");
      expect(mocks.redirect).not.toHaveBeenCalled();
    });
  });

  describe("revokeInvitationAction", () => {
    it("revokes the invitation and refreshes the roster", async () => {
      const { client, rpc } = createClient();
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { revokeInvitationAction } = await loadActions();

      const result = await revokeInvitationAction(
        idleState,
        formData({ groupId, invitationId }),
      );

      expect(rpc).toHaveBeenCalledWith("revoke_invitation", {
        invitation_id: invitationId,
      });
      expect(result.status).toBe("success");
      expect(mocks.revalidatePath).toHaveBeenCalledWith(membersPath);
    });

    it("treats an already settled invitation as an error", async () => {
      const { client } = createClient({ data: false });
      mocks.createServerSupabaseClient.mockResolvedValue(client);
      const { revokeInvitationAction } = await loadActions();

      expect(
        (
          await revokeInvitationAction(
            idleState,
            formData({ groupId, invitationId }),
          )
        ).status,
      ).toBe("error");
    });
  });
});
