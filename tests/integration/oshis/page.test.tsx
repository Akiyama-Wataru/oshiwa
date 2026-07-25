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
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(),
}));

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const oshiId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const userId = "1f0f2b1c-4b6f-4a3d-9d0e-2b6f1a2c3d4e";
const imagePath = `${groupId}/${oshiId}/${"a".repeat(32)}.webp`;

function createClient(options: {
  user?: { id: string } | null;
  membership?: unknown;
  oshis?: unknown;
  signed?: unknown;
}) {
  const createSignedUrls = vi.fn().mockResolvedValue({
    data: options.signed ?? [],
    error: null,
  });
  const order = vi.fn().mockResolvedValue({
    data: options.oshis ?? [],
    error: null,
  });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options.membership ?? null,
    error: null,
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
          data: { user: options.user === undefined ? { id: userId } : options.user },
          error: options.user === null ? new Error("no session") : null,
        }),
      },
      from: vi.fn((table: string) =>
        table === "memberships" ? membershipQuery : oshiQuery,
      ),
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    },
    createSignedUrls,
    membershipQuery,
    oshiQuery,
  };
}

async function renderPage(id: string = groupId) {
  const { default: OshisPage } = await import(
    "@/app/groups/[groupId]/oshis/page"
  );

  render(await OshisPage({ params: Promise.resolve({ groupId: id }) }));
}

describe("OshisPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an unauthenticated visitor to a safe login return path", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ user: null }).client,
    );

    await expect(renderPage()).rejects.toThrow(
      `REDIRECT:/login?returnTo=${encodeURIComponent(`/groups/${groupId}/oshis`)}`,
    );
  });

  it("does not confirm that a group exists to a non-member", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ membership: null }).client,
    );

    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("rejects a group id that is not a uuid before opening a connection", async () => {
    await expect(renderPage("friends")).rejects.toThrow("NOT_FOUND");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("reads only the membership row that belongs to the viewer", async () => {
    const { client, membershipQuery } = createClient({
      membership: { role: "member", groups: { name: "ライブ遠征組" } },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await renderPage();

    expect(membershipQuery.eq).toHaveBeenCalledWith("group_id", groupId);
    expect(membershipQuery.eq).toHaveBeenCalledWith("user_id", userId);
  });

  it("renders the group oshis with short lived signed photo urls", async () => {
    const { client, createSignedUrls } = createClient({
      membership: { role: "owner", groups: { name: "ライブ遠征組" } },
      oshis: [
        {
          id: oshiId,
          name: "ミナ",
          member_color: "#ff6f91",
          image_path: imagePath,
          created_by: userId,
        },
      ],
      signed: [{ path: imagePath, signedUrl: "https://storage.test/signed" }],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "ライブ遠征組の推し" }),
    ).toBeVisible();
    expect(screen.getByAltText("ミナの写真")).toHaveAttribute(
      "src",
      "https://storage.test/signed",
    );

    const [paths, ttl] = createSignedUrls.mock.calls[0];
    expect(paths).toEqual([imagePath]);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("skips signing entirely when no oshi has a photo", async () => {
    const { client, createSignedUrls } = createClient({
      membership: { role: "member", groups: { name: "ライブ遠征組" } },
      oshis: [
        {
          id: oshiId,
          name: "ミナ",
          member_color: "#ff6f91",
          image_path: null,
          created_by: userId,
        },
      ],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await renderPage();

    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(
      screen.getByText("写真はまだ登録されていません。"),
    ).toBeVisible();
  });

  it("offers reordering to managers only", async () => {
    const { client } = createClient({
      membership: { role: "member", groups: { name: "ライブ遠征組" } },
      oshis: [
        {
          id: oshiId,
          name: "ミナ",
          member_color: "#ff6f91",
          created_by: userId,
        },
      ],
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await renderPage();

    expect(
      screen.queryByRole("button", { name: "並び順を保存" }),
    ).not.toBeInTheDocument();
  });

  it("explains a missing local configuration instead of crashing", async () => {
    const { SupabaseConfigurationError } = await import("@/lib/env");
    mocks.createServerSupabaseClient.mockRejectedValue(
      new SupabaseConfigurationError("not configured"),
    );

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "認証接続が未設定です" }),
    ).toBeVisible();
  });

  it("keeps the page out of search results", async () => {
    const { metadata } = await import("@/app/groups/[groupId]/oshis/page");

    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
