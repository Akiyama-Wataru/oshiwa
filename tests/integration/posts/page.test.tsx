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
const oshiId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const userId = "1f0f2b1c-4b6f-4a3d-9d0e-2b6f1a2c3d4e";
const basePath = `/groups/${groupId}/posts`;
const imagePath = `${groupId}/${postId}/${"a".repeat(32)}.webp`;

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
    ...overrides,
  };
}

function createClient(options: {
  user?: { id: string } | null;
  membership?: unknown;
  membershipError?: unknown;
  oshis?: unknown;
  posts?: unknown;
  postsError?: unknown;
  signed?: unknown;
} = {}) {
  const createSignedUrls = vi
    .fn()
    .mockResolvedValue({ data: options.signed ?? [], error: null });
  const order = vi
    .fn()
    .mockResolvedValue({ data: options.oshis ?? [], error: null });
  const maybeSingle = vi.fn().mockResolvedValue({
    data:
      options.membership === undefined
        ? { role: "member", groups: { name: "推し会" } }
        : options.membership,
    error: options.membershipError ?? null,
  });
  const rpc = vi.fn().mockResolvedValue({
    data: options.posts ?? [],
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
    order,
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
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    },
    createSignedUrls,
    rpc,
  };
}

async function renderPage(
  query: Record<string, string | string[]> = {},
  id: string = groupId,
) {
  const { default: PostsPage } = await import(
    "@/app/groups/[groupId]/posts/page"
  );

  render(
    await PostsPage({
      params: Promise.resolve({ groupId: id }),
      searchParams: Promise.resolve(query),
    }),
  );
}

describe("PostsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an unauthenticated visitor to a safe login return path", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ user: null }).client,
    );

    await expect(renderPage()).rejects.toThrow(
      `REDIRECT:/login?returnTo=${encodeURIComponent(basePath)}`,
    );
  });

  it("refuses a group id that is not a uuid before any lookup", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(createClient().client);

    await expect(renderPage({}, "not-a-uuid")).rejects.toThrow("NOT_FOUND");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("answers a non-member exactly as it answers a missing group", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ membership: null }).client,
    );

    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
  });

  it("never reports a broken lookup as a group that vanished", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ membershipError: new Error("connection reset") }).client,
    );

    await renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "タイムラインを読み込めませんでした",
      }),
    ).toBeVisible();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("reads the group timeline and signs only the paths it will render", async () => {
    const { client, rpc, createSignedUrls } = createClient({
      posts: [postRow({ images: [{ image_path: imagePath, sort_order: 1 }] })],
      signed: [{ path: imagePath, signedUrl: "https://example.test/a" }],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await renderPage();

    expect(rpc).toHaveBeenCalledWith("list_group_posts", {
      target_group_id: groupId,
      filter_oshi_id: null,
      filter_tag: null,
      before_created_at: null,
      before_id: null,
      page_size: 20,
    });
    expect(createSignedUrls).toHaveBeenCalledWith([imagePath], 300);
    expect(screen.getByRole("article")).toHaveTextContent("一曲目からよかった");
    expect(screen.getByAltText("みおの投稿の写真1枚目")).toHaveAttribute(
      "src",
      "https://example.test/a",
    );
  });

  it("passes the filters and the cursor the reader chose", async () => {
    const { client, rpc } = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await renderPage({
      oshi: oshiId,
      tag: "#尊い",
      before: `2026-07-27T11:00:00+00:00_${postId}`,
    });

    expect(rpc).toHaveBeenCalledWith("list_group_posts", {
      target_group_id: groupId,
      filter_oshi_id: oshiId,
      filter_tag: "尊い",
      before_created_at: "2026-07-27T11:00:00+00:00",
      before_id: postId,
      page_size: 20,
    });
  });

  it("drops a filter it cannot parse instead of failing the page", async () => {
    const { client, rpc } = createClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await renderPage({
      oshi: "not-a-uuid",
      tag: "  ",
      before: "'; drop table posts; --",
    });

    expect(rpc).toHaveBeenCalledWith("list_group_posts", {
      target_group_id: groupId,
      filter_oshi_id: null,
      filter_tag: null,
      before_created_at: null,
      before_id: null,
      page_size: 20,
    });
    expect(screen.getByText("まだ投稿がありません。")).toBeVisible();
  });

  it("says the timeline is unavailable rather than that it is empty", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ postsError: new Error("statement timeout") }).client,
    );

    await renderPage();

    const notice = screen.getByRole("alert");

    expect(notice).toHaveTextContent("タイムラインを読み込めませんでした");
    expect(notice).not.toHaveTextContent("timeout");
  });

  it("offers the group's oshis to the composer and the filters", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({
        oshis: [
          {
            id: oshiId,
            name: "ミナ",
            member_color: "#ff6f91",
            image_path: null,
            created_by: userId,
          },
        ],
      }).client,
    );

    await renderPage();

    expect(screen.getByLabelText("ミナ")).toHaveAttribute("type", "checkbox");
    expect(screen.getByRole("option", { name: "ミナ" })).toBeInTheDocument();
  });

  it("explains a missing local configuration outside production", async () => {
    const { SupabaseConfigurationError } = await import("@/lib/env");
    mocks.createServerSupabaseClient.mockRejectedValue(
      new SupabaseConfigurationError("not configured"),
    );

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "認証接続が未設定です" }),
    ).toBeVisible();
  });
});
