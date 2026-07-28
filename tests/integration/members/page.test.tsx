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
const ownerId = "1f0f2b1c-4b6f-4a3d-9d0e-2b6f1a2c3d4e";
const adminId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const memberId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const invitationId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const basePath = `/groups/${groupId}/members`;

const roster = [
  { user_id: ownerId, role: "owner", profiles: { display_name: "おーな" } },
  { user_id: adminId, role: "admin", profiles: { display_name: "あどみん" } },
  { user_id: memberId, role: "member", profiles: { display_name: "めんばー" } },
];

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: invitationId,
    email_normalized: "fan@example.com",
    role: "member",
    expires_at: "2099-01-01T00:00:00+00:00",
    revoked_at: null,
    accepted_at: null,
    delivery_state: "sent",
    ...overrides,
  };
}

function createClient(options: {
  user?: { id: string } | null;
  viewerRole?: string;
  membership?: unknown;
  membershipError?: unknown;
  members?: unknown;
  membersError?: unknown;
  invitations?: unknown;
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data:
      options.membership === undefined
        ? {
            role: options.viewerRole ?? "owner",
            groups: { name: "推し会" },
          }
        : options.membership,
    error: options.membershipError ?? null,
  });
  const membershipQuery = {
    select: vi.fn(() => membershipQuery),
    eq: vi.fn(() => membershipQuery),
    maybeSingle,
    then: undefined as unknown,
  };

  // The roster query awaits the builder itself rather than a terminal method.
  const rosterResult = {
    data: options.members ?? roster,
    error: options.membersError ?? null,
  };
  const rosterQuery = {
    select: vi.fn(() => rosterQuery),
    eq: vi.fn(() => rosterQuery),
    then: (resolve: (value: unknown) => unknown) => resolve(rosterResult),
  };
  const invitationQuery = {
    select: vi.fn(() => invitationQuery),
    eq: vi.fn(() => invitationQuery),
    order: vi
      .fn()
      .mockResolvedValue({ data: options.invitations ?? [], error: null }),
  };

  let membershipCalls = 0;

  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: options.user === undefined ? { id: ownerId } : options.user,
          },
          error: options.user === null ? new Error("no session") : null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "invitations") {
          return invitationQuery;
        }

        membershipCalls += 1;
        // The first memberships read resolves the viewer, the second the list.
        return membershipCalls === 1 ? membershipQuery : rosterQuery;
      }),
    },
    invitationQuery,
  };
}

async function renderPage(id: string = groupId) {
  const { default: MembersPage } = await import(
    "@/app/groups/[groupId]/members/page"
  );

  render(await MembersPage({ params: Promise.resolve({ groupId: id }) }));
}

describe("MembersPage", () => {
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
        name: "メンバーを読み込めませんでした",
      }),
    ).toBeVisible();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("lists everyone with their role, managers first", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(createClient().client);

    await renderPage();

    const names = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");

    expect(names[0]).toContain("おーな");
    expect(names[names.length - 1]).toContain("めんばー");
    expect(screen.getByText("あなた")).toBeVisible();
  });

  it("offers the role control to an owner and to nobody else", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(createClient().client);

    await renderPage();

    expect(screen.getByLabelText("あどみんの権限")).toBeVisible();
    // The sole owner is their own last owner, so their role is not offered.
    expect(screen.queryByLabelText("おーなの権限")).toBeNull();
  });

  it("hides the role and removal controls from a plain member", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ viewerRole: "member", user: { id: memberId } }).client,
    );

    await renderPage();

    expect(screen.queryByLabelText("あどみんの権限")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /輪から外す$/u }),
    ).toBeNull();
    expect(screen.getByText("この輪から抜ける")).toBeVisible();
  });

  it("keeps the sole owner from being offered a way out", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(createClient().client);

    await renderPage();

    // Leaving would strand the group with no owner, and the database refuses
    // it, so the panel is not offered at all.
    expect(screen.queryByText("この輪から抜ける")).toBeNull();
  });

  it("shows a manager the invitations that are still outstanding", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({
        invitations: [invitation(), invitation({ revoked_at: "2020-01-01T00:00:00+00:00" })],
      }).client,
    );

    await renderPage();

    expect(
      screen.getByRole("button", { name: "fan@example.comの招待を取り消す" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /招待を取り消す$/u }),
    ).toHaveLength(1);
  });

  it("warns a manager when the invitation email never left", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({
        invitations: [invitation({ delivery_state: "failed" })],
      }).client,
    );

    await renderPage();

    expect(screen.getByText(/メールを送信できませんでした/u)).toBeVisible();
  });

  it("never reads the invitation table for a plain member", async () => {
    const { client, invitationQuery } = createClient({
      viewerRole: "member",
      user: { id: memberId },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await renderPage();

    expect(invitationQuery.select).not.toHaveBeenCalled();
    expect(screen.queryByText("返信待ちの招待")).toBeNull();
  });

  it("says the roster is unavailable rather than that the group is empty", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      createClient({ membersError: new Error("statement timeout") }).client,
    );

    await renderPage();

    const notice = screen.getByRole("alert");

    expect(notice).toHaveTextContent("メンバーを読み込めませんでした");
    expect(notice).not.toHaveTextContent("timeout");
  });

  it("refuses a group id that is not a uuid before any lookup", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(createClient().client);

    await expect(renderPage("not-a-uuid")).rejects.toThrow("NOT_FOUND");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });
});
