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

function clientWithMemberships(memberships: unknown, unread: unknown = 0) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "user-1",
            email: "fan@example.com",
            email_confirmed_at: "2026-07-24T00:00:00Z",
          },
        },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: memberships, error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: unread, error: null }),
  };
}

describe("GroupsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists group names and roles and offers invites only to managers", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      clientWithMemberships([
        {
          group_id: "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd",
          role: "owner",
          groups: {
            id: "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd",
            name: "ライブ遠征組",
          },
        },
        {
          group_id: "5ef863c5-19ce-48c1-a559-f6b69b767018",
          role: "member",
          groups: {
            id: "5ef863c5-19ce-48c1-a559-f6b69b767018",
            name: "同担の輪",
          },
        },
      ]),
    );
    const { default: GroupsPage } = await import("@/app/groups/page");

    render(await GroupsPage());

    expect(screen.getByText("ライブ遠征組")).toBeVisible();
    expect(screen.getByText("同担の輪")).toBeVisible();
    expect(screen.getByText("オーナー")).toBeVisible();
    expect(
      screen.getByText("メンバー", { selector: ".role-badge" }),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "招待を作成" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("button", { name: "グループを作る" })).toBeEnabled();
  });

  it("leads every member, not only managers, to that group's oshis", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      clientWithMemberships([
        {
          group_id: "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd",
          role: "member",
          groups: {
            id: "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd",
            name: "同担の輪",
          },
        },
      ]),
    );
    const { default: GroupsPage } = await import("@/app/groups/page");

    render(await GroupsPage());

    expect(
      screen.getByRole("link", { name: "同担の輪の推しを見る" }),
    ).toHaveAttribute(
      "href",
      "/groups/2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd/oshis",
    );
  });

  it("shows a useful empty state when the user has no memberships", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      clientWithMemberships([]),
    );
    const { default: GroupsPage } = await import("@/app/groups/page");

    render(await GroupsPage());

    expect(screen.getByText(/まだグループに参加していません/)).toBeVisible();
    expect(screen.getByRole("button", { name: "グループを作る" })).toBeEnabled();
  });

  it("says how many notifications are waiting, and links to them", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      clientWithMemberships([], 4),
    );
    const { default: GroupsPage } = await import("@/app/groups/page");

    render(await GroupsPage());

    expect(
      screen.getByRole("link", { name: "お知らせ（未読4件）" }),
    ).toHaveAttribute("href", "/notifications");
  });

  it("keeps the circles when the unread count cannot be read", async () => {
    const client = clientWithMemberships([
      {
        group_id: "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd",
        role: "member",
        groups: {
          id: "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd",
          name: "同担の輪",
        },
      },
    ]);
    client.rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("statement timeout") });
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    const { default: GroupsPage } = await import("@/app/groups/page");

    render(await GroupsPage());

    // The badge is a hint. A failed hint must not cost the reader their list.
    expect(screen.getByText("同担の輪")).toBeVisible();
    expect(screen.getByRole("link", { name: "お知らせ" })).toBeVisible();
  });

  it("redirects an unauthenticated visitor before loading memberships", async () => {
    const from = vi.fn();
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
      from,
    });
    const { default: GroupsPage } = await import("@/app/groups/page");

    await expect(GroupsPage()).rejects.toThrow(
      "REDIRECT:/login?returnTo=%2Fgroups",
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("shows both the creation receipt and a recoverable membership load error", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "fan@example.com",
              email_confirmed_at: "2026-07-24T00:00:00Z",
            },
          },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({
          data: null,
          error: new Error("private query detail"),
        }),
      })),
      rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
    });
    const { default: GroupsPage } = await import("@/app/groups/page");

    render(
      await GroupsPage({
        searchParams: Promise.resolve({ created: "1" }),
      }),
    );

    expect(screen.getByText("グループを作成しました。")).toBeVisible();
    expect(
      screen.getByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent(
      "グループを読み込めませんでした。時間をおいて再読み込みしてください。",
    );
    expect(screen.queryByText("private query detail")).not.toBeInTheDocument();
  });

  it("normalizes array relations and discards malformed membership rows", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      clientWithMemberships([
        null,
        42,
        { role: "owner", groups: null },
        {
          role: "owner",
          groups: { id: 12, name: "型が不正な輪" },
        },
        {
          role: "super-admin",
          groups: {
            id: "7842b365-06dc-435a-9562-38c6a9fab755",
            name: "未知権限の輪",
          },
        },
        {
          role: "admin",
          groups: [
            {
              id: "e22b8e6a-d46b-4fac-8ef9-a935bf1a45b8",
              name: "配列で返る輪",
            },
          ],
        },
      ]),
    );
    const { default: GroupsPage } = await import("@/app/groups/page");

    render(await GroupsPage());

    expect(screen.getByText("配列で返る輪")).toBeVisible();
    expect(
      screen.getByText("管理者", { selector: ".role-badge" }),
    ).toBeVisible();
    expect(screen.queryByText("型が不正な輪")).not.toBeInTheDocument();
    expect(screen.queryByText("未知権限の輪")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "招待を作成" })).toHaveLength(
      1,
    );
  });

  it("treats a malformed non-array membership response as an empty list", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      clientWithMemberships({ unexpected: "shape" }),
    );
    const { default: GroupsPage } = await import("@/app/groups/page");

    render(await GroupsPage());

    expect(screen.getByText(/まだグループに参加していません/)).toBeVisible();
    expect(screen.queryByRole("list", { name: "参加中のグループ" }))
      .not.toBeInTheDocument();
  });

  it("shows a local setup explanation for missing Supabase configuration", async () => {
    const { SupabaseConfigurationError } = await import("@/lib/env");
    mocks.createServerSupabaseClient.mockRejectedValue(
      new SupabaseConfigurationError("missing private URL"),
    );
    const { default: GroupsPage } = await import("@/app/groups/page");

    render(await GroupsPage());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "認証接続が未設定です",
      }),
    ).toBeVisible();
    expect(screen.getByText("LOCAL PREVIEW")).toBeVisible();
    expect(screen.queryByText("missing private URL")).not.toBeInTheDocument();
  });

  it("does not swallow an unexpected server failure", async () => {
    const failure = new Error("unexpected runtime failure");
    mocks.createServerSupabaseClient.mockRejectedValue(failure);
    const { default: GroupsPage } = await import("@/app/groups/page");

    await expect(GroupsPage()).rejects.toBe(failure);
  });
});
