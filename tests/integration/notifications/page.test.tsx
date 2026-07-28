import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(),
}));

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const postId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const notificationId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const otherNotificationId = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const userId = "1f0f2b1c-4b6f-4a3d-9d0e-2b6f1a2c3d4e";
const actorId = "4d2f6b18-2a70-4a1f-91b1-9d3a2c5e7f01";
const idleState = { status: "idle", message: "" } as const;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: notificationId,
    kind: "like",
    created_at: "2026-07-28T10:00:00+00:00",
    read_at: null,
    group_id: groupId,
    group_name: "推し会",
    post_id: postId,
    post_excerpt: "今日のライブ最高だった",
    reply_id: null,
    reply_body: null,
    actor_id: actorId,
    actor_name: "みお",
    ...overrides,
  };
}

function createClient(
  options: {
    user?: { id: string } | null;
    notifications?: unknown;
    listError?: unknown;
    rpc?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const rpc =
    options.rpc ??
    vi.fn().mockResolvedValue({
      data: options.notifications ?? [row()],
      error: options.listError ?? null,
    });

  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: options.user === undefined ? { id: userId } : options.user,
          },
          error: options.user === null ? new Error("no session") : null,
        }),
      },
      rpc,
    },
    rpc,
  };
}

async function renderPage() {
  const { default: NotificationsPage } = await import("@/app/notifications/page");

  render(await NotificationsPage());
}

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an unauthenticated visitor to a safe login return path", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ user: null }).client,
    );

    await expect(renderPage()).rejects.toThrow(
      "REDIRECT:/login?returnTo=%2Fnotifications",
    );
  });

  it("says what happened and leads to the post itself", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(createClient().client);

    await renderPage();

    const link = screen.getByRole("link", { name: /みおがいいねしました/u });

    // The circle's timeline would be no help for an old post: the link has to
    // land on the post the notification is about.
    expect(link).toHaveAttribute("href", `/groups/${groupId}/posts/${postId}`);
    expect(screen.getByText("未読")).toBeVisible();
  });

  it("counts the unread ones and offers to clear them", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({
        notifications: [
          row(),
          row({ id: otherNotificationId, read_at: "2026-07-28T11:00:00+00:00" }),
        ],
      }).client,
    );

    await renderPage();

    expect(screen.getByText("未読が1件あります。")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "すべて既読にする" }),
    ).toBeVisible();
  });

  it("offers nothing to clear once everything has been read", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({
        notifications: [row({ read_at: "2026-07-28T11:00:00+00:00" })],
      }).client,
    );

    await renderPage();

    expect(screen.getByText("未読のお知らせはありません。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "すべて既読にする" })).toBeNull();
  });

  it("invites the first reaction when nothing has happened yet", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ notifications: [] }).client,
    );

    await renderPage();

    expect(screen.getByText("まだお知らせはありません。")).toBeVisible();
  });

  it("says the list is unavailable rather than that it is empty", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ listError: new Error("statement timeout") }).client,
    );

    await renderPage();

    const notice = screen.getByRole("alert");

    expect(notice).toHaveTextContent("お知らせを読み込めませんでした");
    expect(notice).not.toHaveTextContent("timeout");
  });
});

describe("markNotificationsReadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the reader's own list without naming any rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 3, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ rpc }).client,
    );
    const { markNotificationsReadAction } = await import(
      "@/app/notifications/actions"
    );

    const result = await markNotificationsReadAction(idleState, new FormData());

    expect(rpc).toHaveBeenCalledWith("mark_notifications_read", {
      notification_ids: null,
    });
    expect(result.status).toBe("success");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/notifications");
  });

  it("hides why the database refused", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("connection reset") });
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ rpc }).client,
    );
    const { markNotificationsReadAction } = await import(
      "@/app/notifications/actions"
    );

    const result = await markNotificationsReadAction(idleState, new FormData());

    expect(result.status).toBe("error");
    expect(result.message).not.toContain("connection reset");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
