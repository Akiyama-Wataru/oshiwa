import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
const replyId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const userId = "1f0f2b1c-4b6f-4a3d-9d0e-2b6f1a2c3d4e";
const threadPath = `/groups/${groupId}/posts/${postId}`;

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: postId,
    body: "一曲目からよかった",
    created_at: "2026-07-27T11:00:00+00:00",
    updated_at: "2026-07-27T11:00:00+00:00",
    author_id: userId,
    author_name: "みお",
    images: [],
    oshis: [],
    hashtags: [],
    like_count: 2,
    liked_by_viewer: true,
    replies: [
      {
        id: replyId,
        body: "行きたかった",
        created_at: "2026-07-27T11:30:00+00:00",
        author_id: "4d2f6b18-2a70-4a1f-91b1-9d3a2c5e7f01",
        author_name: "はな",
      },
    ],
    reply_count: 1,
    shares: [],
    share_count: 0,
    shared_by_viewer: false,
    ...overrides,
  };
}

function createClient(
  options: {
    user?: { id: string } | null;
    membership?: unknown;
    membershipError?: unknown;
    posts?: unknown;
    postsError?: unknown;
  } = {},
) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data:
      options.membership === undefined
        ? { role: "member", groups: { name: "推し会" } }
        : options.membership,
    error: options.membershipError ?? null,
  });
  const rpc = vi.fn().mockResolvedValue({
    data: options.posts ?? [postRow()],
    error: options.postsError ?? null,
  });
  const membershipQuery = {
    select: vi.fn(() => membershipQuery),
    eq: vi.fn(() => membershipQuery),
    maybeSingle,
  };
  const oshiQuery = {
    select: vi.fn(() => oshiQuery),
    eq: vi.fn(() => oshiQuery),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  };

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
      from: vi.fn((table: string) =>
        table === "memberships" ? membershipQuery : oshiQuery,
      ),
      rpc,
      storage: {
        from: vi.fn(() => ({
          createSignedUrls: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      },
    },
    rpc,
  };
}

async function renderPage(ids: { groupId?: string; postId?: string } = {}) {
  const { default: PostThreadPage } = await import(
    "@/app/groups/[groupId]/posts/[postId]/page"
  );

  render(
    await PostThreadPage({
      params: Promise.resolve({
        groupId: ids.groupId ?? groupId,
        postId: ids.postId ?? postId,
      }),
    }),
  );
}

describe("PostThreadPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an unauthenticated visitor back to the post they asked for", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ user: null }).client,
    );

    await expect(renderPage()).rejects.toThrow(
      `REDIRECT:/login?returnTo=${encodeURIComponent(threadPath)}`,
    );
  });

  it("asks for the post and the circle together", async () => {
    const { client, rpc } = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await renderPage();

    // Naming both means a link that pairs a post with the wrong circle finds
    // nothing rather than answering under it.
    expect(rpc).toHaveBeenCalledWith("get_group_post", {
      target_post_id: postId,
      target_group_id: groupId,
    });
  });

  it("shows the post with its whole conversation", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(createClient().client);

    await renderPage();

    expect(screen.getByRole("article")).toHaveTextContent("一曲目からよかった");
    expect(screen.getByRole("list", { name: "返信" }).children).toHaveLength(1);
    expect(screen.getByText("行きたかった")).toBeVisible();
    // Everything is already here, so there is nowhere further to go.
    expect(screen.queryByRole("link", { name: /返信をすべて見る/u })).toBeNull();
  });

  it("answers a post from another circle exactly as a missing one", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ posts: [] }).client,
    );

    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
  });

  it("answers a non-member exactly as a missing group", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ membership: null }).client,
    );

    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
  });

  it("never reports a broken lookup as a post that vanished", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ postsError: new Error("statement timeout") }).client,
    );

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "投稿を読み込めませんでした" }),
    ).toBeVisible();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("refuses identifiers that are not uuids before any lookup", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(createClient().client);

    await expect(renderPage({ postId: "not-a-uuid" })).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("offers the way back to the timeline", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(createClient().client);

    await renderPage();

    expect(
      screen.getByRole("link", { name: "タイムラインへ" }),
    ).toHaveAttribute("href", `/groups/${groupId}/posts`);
  });
});
