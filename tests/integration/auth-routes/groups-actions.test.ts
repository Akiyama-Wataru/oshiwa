import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const invitationId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const rawToken = "a".repeat(64);

function createDeliveryAdmin(
  inviteError: unknown = null,
  updateError: unknown = null,
) {
  const eq = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ eq }));
  const inviteUserByEmail = vi.fn().mockResolvedValue({ error: inviteError });
  return {
    client: {
      auth: { admin: { inviteUserByEmail } },
      from: vi.fn(() => ({ update })),
    },
    eq,
    update,
    inviteUserByEmail,
  };
}

describe("group server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://oshiwa.test");
  });

  it("creates a group from a trimmed 1–100 character name and redirects", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: groupId, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const { createGroupAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("name", "  いつもの輪  ");

    await expect(
      createGroupAction({ status: "idle", message: "" }, formData),
    ).rejects.toThrow("REDIRECT:/groups?created=1");
    expect(rpc).toHaveBeenCalledWith("create_group", {
      group_name: "いつもの輪",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/groups");
  });

  it("does not call the database for an invalid group name", async () => {
    const rpc = vi.fn();
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const { createGroupAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("name", " ");

    const result = await createGroupAction(
      { status: "idle", message: "" },
      formData,
    );

    expect(result.status).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a public error when group creation is rejected by the database", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("private database policy detail"),
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const { createGroupAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("name", "遠征仲間");

    const result = await createGroupAction(
      { status: "idle", message: "" },
      formData,
    );

    expect(result).toEqual({
      status: "error",
      message:
        "グループを作成できませんでした。しばらく待ってからお試しください。",
    });
    expect(result.message).not.toContain("policy");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("explains missing local configuration without leaking its exception", async () => {
    const { SupabaseConfigurationError } = await import("@/lib/env");
    mocks.createServerSupabaseClient.mockRejectedValue(
      new SupabaseConfigurationError("missing private connection value"),
    );
    const { createGroupAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("name", "遠征仲間");

    const result = await createGroupAction(
      { status: "idle", message: "" },
      formData,
    );

    expect(result).toEqual({
      status: "error",
      message: "ローカルプレビューではグループ作成が未設定です。",
    });
    expect(result.message).not.toContain("private");
  });

  it("generalizes unexpected group-creation failures", async () => {
    mocks.createServerSupabaseClient.mockRejectedValue(
      new Error("socket address and credentials"),
    );
    const { createGroupAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("name", "遠征仲間");

    const result = await createGroupAction(
      { status: "idle", message: "" },
      formData,
    );

    expect(result.status).toBe("error");
    expect(result.message).not.toMatch(/socket|credentials/);
  });

  it("rejects invalid invitation input before authorization or admin delivery", async () => {
    const rpc = vi.fn();
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const { inviteMemberAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("groupId", "not-a-group-id");
    formData.set("email", "not-an-email");
    formData.set("role", "owner");

    const result = await inviteMemberAction(
      { status: "idle", message: "", manualLink: null },
      formData,
    );

    expect(result).toMatchObject({ status: "error", manualLink: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it("authorizes through RPC before admin delivery and returns only a manual token link", async () => {
    const order: string[] = [];
    const rpc = vi.fn(async () => {
      order.push("authenticated-rpc");
      return {
        data: [
          {
            invitation_id: invitationId,
            invite_token: rawToken,
            expires_at: "2026-07-31T00:00:00Z",
          },
        ],
        error: null,
      };
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const admin = createDeliveryAdmin();
    admin.inviteUserByEmail.mockImplementation(async () => {
      order.push("admin-delivery");
      return { error: null };
    });
    mocks.createAdminSupabaseClient.mockImplementation(() => {
      order.push("admin-client");
      return admin.client;
    });
    const { inviteMemberAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("email", " FAN@EXAMPLE.COM ");
    formData.set("role", "admin");

    const result = await inviteMemberAction(
      { status: "idle", message: "", manualLink: null },
      formData,
    );

    expect(order).toEqual([
      "authenticated-rpc",
      "admin-client",
      "admin-delivery",
    ]);
    expect(rpc).toHaveBeenCalledWith("create_invitation", {
      target_group_id: groupId,
      invitee_email: "fan@example.com",
      invited_role: "admin",
    });
    expect(admin.inviteUserByEmail).toHaveBeenCalledWith(
      "fan@example.com",
      {
        redirectTo: `https://oshiwa.test/join/${rawToken}?setup=1`,
      },
    );
    expect(admin.update).toHaveBeenCalledWith({ delivery_state: "sent" });
    expect(admin.eq).toHaveBeenCalledWith("id", invitationId);
    expect(result).toMatchObject({
      status: "success",
      manualLink: `/join/${rawToken}`,
    });
    expect(Object.keys(result)).toEqual(["status", "message", "manualLink"]);
  });

  it("never reaches admin APIs when the authenticated authorization RPC fails", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("not allowed for private group"),
      }),
    });
    const { inviteMemberAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("email", "fan@example.com");
    formData.set("role", "member");

    const result = await inviteMemberAction(
      { status: "idle", message: "", manualLink: null },
      formData,
    );

    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.message).not.toContain("private group");
    expect(result.manualLink).toBeNull();
  });

  it("rejects malformed invitation output before exposing a link or using admin APIs", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          invitation_id: invitationId,
          invite_token: "provider-returned-secret",
        },
      ],
      error: null,
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const { inviteMemberAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("email", "fan@example.com");
    formData.set("role", "member");

    const result = await inviteMemberAction(
      { status: "idle", message: "", manualLink: null },
      formData,
    );

    expect(result).toMatchObject({ status: "error", manualLink: null });
    expect(result.message).not.toContain("provider-returned-secret");
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it("marks failed delivery and still returns the authorized manual link", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          invitation_id: invitationId,
          invite_token: rawToken,
          expires_at: "2026-07-31T00:00:00Z",
        },
      ],
      error: null,
    });
    mocks.createServerSupabaseClient.mockResolvedValue({
      rpc,
    });
    const privateProviderError = new Error("SMTP secret provider detail");
    const admin = createDeliveryAdmin(privateProviderError);
    mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
    const { inviteMemberAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("email", "fan@example.com");
    formData.set("role", "member");

    const result = await inviteMemberAction(
      { status: "idle", message: "", manualLink: null },
      formData,
    );

    expect(admin.update).toHaveBeenCalledWith({ delivery_state: "failed" });
    expect(rpc).toHaveBeenLastCalledWith(
      "mark_invitation_delivery_failed",
      { invitation_id: invitationId },
    );
    expect(result.status).toBe("warning");
    expect(result.manualLink).toBe(`/join/${rawToken}`);
    expect(result.message).not.toMatch(/SMTP|secret|provider/i);
  });

  it("compensates through authenticated RPC when admin initialization fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          invitation_id: invitationId,
          invite_token: rawToken,
          expires_at: "2026-07-31T00:00:00Z",
        },
      ],
      error: null,
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    mocks.createAdminSupabaseClient.mockImplementation(() => {
      throw new Error("server secret is not configured");
    });
    const { inviteMemberAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("email", "fan@example.com");
    formData.set("role", "member");

    const result = await inviteMemberAction(
      { status: "idle", message: "", manualLink: null },
      formData,
    );

    expect(rpc).toHaveBeenNthCalledWith(1, "create_invitation", {
      target_group_id: groupId,
      invitee_email: "fan@example.com",
      invited_role: "member",
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "mark_invitation_delivery_failed",
      { invitation_id: invitationId },
    );
    expect(result.status).toBe("warning");
    expect(result.manualLink).toBe(`/join/${rawToken}`);
    expect(result.message).not.toContain("server secret");
  });

  it("compensates when the service-role delivery-state update fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          invitation_id: invitationId,
          invite_token: rawToken,
          expires_at: "2026-07-31T00:00:00Z",
        },
      ],
      error: null,
    });
    mocks.createServerSupabaseClient.mockResolvedValue({
      rpc,
    });
    const admin = createDeliveryAdmin(
      null,
      new Error("service update detail"),
    );
    mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
    const { inviteMemberAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("email", "fan@example.com");
    formData.set("role", "member");

    const result = await inviteMemberAction(
      { status: "idle", message: "", manualLink: null },
      formData,
    );

    expect(admin.update).toHaveBeenCalledWith({ delivery_state: "sent" });
    expect(rpc).toHaveBeenLastCalledWith(
      "mark_invitation_delivery_failed",
      { invitation_id: invitationId },
    );
    expect(result.status).toBe("warning");
    expect(result.manualLink).toBe(`/join/${rawToken}`);
    expect(result.message).not.toContain("service update detail");
  });

  it("marks delivery failed when the configured public site URL is invalid", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "ftp://oshiwa.test");
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          invitation_id: invitationId,
          invite_token: rawToken,
        },
      ],
      error: null,
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const admin = createDeliveryAdmin();
    mocks.createAdminSupabaseClient.mockReturnValue(admin.client);
    const { inviteMemberAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("email", "fan@example.com");
    formData.set("role", "member");

    const result = await inviteMemberAction(
      { status: "idle", message: "", manualLink: null },
      formData,
    );

    expect(admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(admin.update).toHaveBeenCalledWith({ delivery_state: "failed" });
    expect(rpc).toHaveBeenLastCalledWith(
      "mark_invitation_delivery_failed",
      { invitation_id: invitationId },
    );
    expect(result).toMatchObject({
      status: "warning",
      manualLink: `/join/${rawToken}`,
    });
  });

  it("keeps the manual recovery link when both delivery and compensation are unavailable", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            invitation_id: invitationId,
            invite_token: rawToken,
          },
        ],
        error: null,
      })
      .mockRejectedValueOnce(new Error("database outage during compensation"));
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    mocks.createAdminSupabaseClient.mockImplementation(() => {
      throw new Error("admin configuration unavailable");
    });
    const { inviteMemberAction } = await import("@/app/groups/actions");
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("email", "fan@example.com");
    formData.set("role", "member");

    const result = await inviteMemberAction(
      { status: "idle", message: "", manualLink: null },
      formData,
    );

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "warning",
      manualLink: `/join/${rawToken}`,
    });
    expect(result.message).not.toContain("outage");
  });

  it("redirects to login after a successful logout", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { signOut },
    });
    const { logoutAction } = await import("@/app/groups/actions");

    await expect(logoutAction()).rejects.toThrow("REDIRECT:/login");
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("keeps the user on the page when the provider rejects logout", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        signOut: vi.fn().mockResolvedValue({
          error: new Error("private provider logout detail"),
        }),
      },
    });
    const { logoutAction } = await import("@/app/groups/actions");

    const result = await logoutAction();

    expect(result).toEqual({
      status: "error",
      message: "ログアウトできませんでした。もう一度お試しください。",
    });
    expect(result.message).not.toContain("provider");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("distinguishes missing local logout configuration from an unexpected failure", async () => {
    const { SupabaseConfigurationError } = await import("@/lib/env");
    const { logoutAction } = await import("@/app/groups/actions");

    mocks.createServerSupabaseClient.mockRejectedValueOnce(
      new SupabaseConfigurationError("missing connection"),
    );
    const configurationResult = await logoutAction();

    mocks.createServerSupabaseClient.mockRejectedValueOnce(
      new Error("private network detail"),
    );
    const unexpectedResult = await logoutAction();

    expect(configurationResult.message).toBe(
      "ローカルプレビューでは認証接続が未設定です。",
    );
    expect(unexpectedResult.message).toBe(
      "ログアウトできませんでした。もう一度お試しください。",
    );
    expect(unexpectedResult.message).not.toContain("network");
  });
});
