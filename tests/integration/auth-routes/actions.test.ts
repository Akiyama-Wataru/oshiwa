import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
  safeReturnTo: vi.fn((value: unknown, fallback = "/groups") =>
    typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
      ? value
      : fallback,
  ),
  mapLoginError: vi.fn(() => ({
    kind: "invalid_credentials",
    status: 401,
    message: "メールアドレスまたはパスワードを確認してください。",
  })),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/auth/redirect", () => ({
  safeReturnTo: mocks.safeReturnTo,
}));
vi.mock("@/lib/auth/login-errors", () => ({
  mapLoginError: mocks.mapLoginError,
}));
vi.mock("@/lib/validation/auth", () => ({
  loginSchema: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  setPasswordSchema: z.object({ password: z.string().min(12) }),
  inviteTokenSchema: z.string().regex(/^[a-f0-9]{64}$/),
}));

describe("authentication server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs in with validated credentials and a safe returnTo", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { signInWithPassword },
    });
    const { loginAction } = await import("@/app/login/actions");
    const formData = new FormData();
    formData.set("email", "fan@example.com");
    formData.set("password", "secret-password");
    formData.set("returnTo", "/groups?from=login");

    await expect(
      loginAction({ status: "idle", message: "" }, formData),
    ).rejects.toThrow("REDIRECT:/groups?from=login");
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "fan@example.com",
      password: "secret-password",
    });
  });

  it("returns one generalized login error without leaking provider details", async () => {
    const providerError = {
      status: 400,
      code: "invalid_credentials",
      message: "provider detail",
    };
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: providerError }),
      },
    });
    const { loginAction } = await import("@/app/login/actions");
    const formData = new FormData();
    formData.set("email", "fan@example.com");
    formData.set("password", "wrong-password");

    const result = await loginAction(
      { status: "idle", message: "" },
      formData,
    );

    expect(mocks.mapLoginError).toHaveBeenCalledWith(providerError);
    expect(result.message).toBe(
      "メールアドレスまたはパスワードを確認してください。",
    );
    expect(result.message).not.toContain("provider");
  });

  it("accepts the invitation before setting a new password", async () => {
    const calls: string[] = [];
    const updateUser = vi.fn(async () => {
      calls.push("password");
      return { error: null };
    });
    const rpc = vi.fn(async () => {
      calls.push("invitation");
      return { error: null };
    });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              email: "fan@example.com",
              email_confirmed_at: "2026-07-24T00:00:00Z",
            },
          },
          error: null,
        }),
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              amr: [{ method: "invite", timestamp: 1 }],
            },
          },
          error: null,
        }),
        updateUser,
      },
      rpc,
    });
    const { joinAction } = await import("@/app/join/[token]/actions");
    const formData = new FormData();
    formData.set("token", "a".repeat(64));
    formData.set("mode", "setup");
    formData.set("password", "twelve-chars!");
    formData.set("passwordConfirmation", "twelve-chars!");

    await expect(
      joinAction({ status: "idle", message: "" }, formData),
    ).rejects.toThrow("REDIRECT:/groups");
    expect(calls).toEqual(["invitation", "password"]);
    expect(rpc).toHaveBeenCalledWith("accept_invitation", {
      invite_token: "a".repeat(64),
    });
  });

  it("does not change the password for invalid, revoked, or raced invitations", async () => {
    const { joinAction } = await import("@/app/join/[token]/actions");
    const messages = [];
    const passwordUpdates = [];

    for (const privateMessage of [
      "invitation token is invalid",
      "invitation was revoked",
      "invitation was accepted by another actor during this request",
      "email mismatch: private@example.com",
    ]) {
      const updateUser = vi.fn().mockResolvedValue({ error: null });
      passwordUpdates.push(updateUser);
      mocks.createServerSupabaseClient.mockResolvedValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                email: "fan@example.com",
                email_confirmed_at: "2026-07-24T00:00:00Z",
              },
            },
            error: null,
          }),
          getClaims: vi.fn().mockResolvedValue({
            data: {
              claims: {
                amr: [{ method: "invite", timestamp: 1 }],
              },
            },
            error: null,
          }),
          updateUser,
        },
        rpc: vi
          .fn()
          .mockResolvedValue({ error: new Error(privateMessage) }),
      });
      const formData = new FormData();
      formData.set("token", "a".repeat(64));
      formData.set("mode", "setup");
      formData.set("password", "twelve-chars!");
      formData.set("passwordConfirmation", "twelve-chars!");

      messages.push(
        (await joinAction({ status: "idle", message: "" }, formData)).message,
      );
    }

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).not.toMatch(
      /invalid|revoked|another actor|mismatch|private@example/,
    );
    for (const updateUser of passwordUpdates) {
      expect(updateUser).not.toHaveBeenCalled();
    }
  });

  it("returns a generic retryable error when password update fails after acceptance", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async () => {
      calls.push("invitation");
      return { error: null };
    });
    const updateUser = vi.fn(async () => {
      calls.push("password");
      return { error: new Error("private auth provider password detail") };
    });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              email: "fan@example.com",
              email_confirmed_at: "2026-07-24T00:00:00Z",
            },
          },
          error: null,
        }),
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              amr: [{ method: "invite", timestamp: 1 }],
            },
          },
          error: null,
        }),
        updateUser,
      },
      rpc,
    });
    const { joinAction } = await import("@/app/join/[token]/actions");
    const formData = new FormData();
    formData.set("token", "d".repeat(64));
    formData.set("mode", "setup");
    formData.set("password", "twelve-chars!");
    formData.set("passwordConfirmation", "twelve-chars!");

    const result = await joinAction(
      { status: "idle", message: "" },
      formData,
    );

    expect(calls).toEqual(["invitation", "password"]);
    expect(result).toEqual({
      status: "error",
      message: "パスワードを設定できませんでした。もう一度お試しください。",
    });
    expect(result.message).not.toMatch(/provider|password detail/i);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("retries an idempotently accepted invitation and completes password setup", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async () => {
      calls.push("invitation");
      return { error: null };
    });
    const updateUser = vi
      .fn()
      .mockImplementationOnce(async () => {
        calls.push("password");
        return { error: new Error("temporary password provider failure") };
      })
      .mockImplementationOnce(async () => {
        calls.push("password");
        return { error: null };
      });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              email: "fan@example.com",
              email_confirmed_at: "2026-07-24T00:00:00Z",
            },
          },
          error: null,
        }),
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              amr: [{ method: "invite", timestamp: 1 }],
            },
          },
          error: null,
        }),
        updateUser,
      },
      rpc,
    });
    const { joinAction } = await import("@/app/join/[token]/actions");
    const formData = new FormData();
    formData.set("token", "e".repeat(64));
    formData.set("mode", "setup");
    formData.set("password", "twelve-chars!");
    formData.set("passwordConfirmation", "twelve-chars!");

    const firstResult = await joinAction(
      { status: "idle", message: "" },
      formData,
    );
    await expect(
      joinAction({ status: "idle", message: "" }, formData),
    ).rejects.toThrow("REDIRECT:/groups");

    expect(firstResult.status).toBe("error");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(updateUser).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      "invitation",
      "password",
      "invitation",
      "password",
    ]);
  });

  it("accepts a manual invitation without changing the existing password", async () => {
    const updateUser = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              email: "existing@example.com",
              email_confirmed_at: "2026-07-24T00:00:00Z",
            },
          },
          error: null,
        }),
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              amr: [{ method: "password", timestamp: 1 }],
            },
          },
          error: null,
        }),
        updateUser,
      },
      rpc,
    });
    const { joinAction } = await import("@/app/join/[token]/actions");
    const formData = new FormData();
    formData.set("token", "b".repeat(64));
    formData.set("mode", "manual");

    await expect(
      joinAction({ status: "idle", message: "" }, formData),
    ).rejects.toThrow("REDIRECT:/groups");
    expect(updateUser).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("accept_invitation", {
      invite_token: "b".repeat(64),
    });
  });

  it.each([
    {
      formMode: "manual",
      amr: [{ method: "invite", timestamp: 1 }],
      label: "invite session cannot skip setup",
    },
    {
      formMode: "setup",
      amr: [{ method: "password", timestamp: 1 }],
      label: "password session cannot trigger password replacement",
    },
  ])("rejects a tampered mode: $label", async ({ formMode, amr }) => {
    const updateUser = vi.fn();
    const rpc = vi.fn();
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              email: "fan@example.com",
              email_confirmed_at: "2026-07-24T00:00:00Z",
            },
          },
          error: null,
        }),
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { amr } },
          error: null,
        }),
        updateUser,
      },
      rpc,
    });
    const { joinAction } = await import("@/app/join/[token]/actions");
    const formData = new FormData();
    formData.set("token", "c".repeat(64));
    formData.set("mode", formMode);
    formData.set("password", "twelve-chars!");
    formData.set("passwordConfirmation", "twelve-chars!");

    const result = await joinAction(
      { status: "idle", message: "" },
      formData,
    );

    expect(result.status).toBe("error");
    expect(updateUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
