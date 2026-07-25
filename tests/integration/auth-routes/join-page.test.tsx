import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

const token = "a".repeat(64);

describe("JoinInvitationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires password setup only for setup=1 invitation callbacks", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              email: "new@example.com",
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
      },
    });
    const { default: JoinInvitationPage } = await import(
      "@/app/join/[token]/page"
    );

    render(
      await JoinInvitationPage({
        params: Promise.resolve({ token }),
        searchParams: Promise.resolve({ setup: "1" }),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "招待を完了" }),
    ).toBeVisible();
    expect(screen.getByText(/安全なパスワードを設定/)).toBeVisible();
    expect(screen.getByLabelText("新しいパスワード")).toBeVisible();
    expect(screen.getByRole("button", { name: "招待に参加する" })).toBeEnabled();
  });

  it("lets an authenticated verified existing user accept without a password", async () => {
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
      },
    });
    const { default: JoinInvitationPage } = await import(
      "@/app/join/[token]/page"
    );

    render(
      await JoinInvitationPage({
        params: Promise.resolve({ token }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "この輪に参加" }),
    ).toBeVisible();
    expect(screen.getByText(/パスワードの変更はありません/)).toBeVisible();
    expect(screen.queryByLabelText("新しいパスワード")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "この招待に参加する" }),
    ).toBeEnabled();
  });

  it("redirects an unauthenticated manual visitor to login with a safe returnTo", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    });
    const { default: JoinInvitationPage } = await import(
      "@/app/join/[token]/page"
    );

    await expect(
      JoinInvitationPage({
        params: Promise.resolve({ token }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(
      `REDIRECT:/login?returnTo=${encodeURIComponent(`/join/${token}`)}`,
    );
  });

  it("does not let an invite-authenticated session bypass setup by removing the query hint", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              email: "new@example.com",
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
      },
    });
    const { default: JoinInvitationPage } = await import(
      "@/app/join/[token]/page"
    );

    render(
      await JoinInvitationPage({
        params: Promise.resolve({ token }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.queryByRole("button", { name: "この招待に参加する" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("新しいパスワード")).toBeVisible();
  });
});
