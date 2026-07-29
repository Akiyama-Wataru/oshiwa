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

const token = "b".repeat(64);
const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const userId = "1f0f2b1c-4b6f-4a3d-9d0e-2b6f1a2c3d4e";
const signupState = { status: "idle", message: "" } as const;
const acceptState = { status: "idle", message: "" } as const;

function formData(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

describe("signupAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://oshiwa.example.test");
  });

  it("registers the member and sends them where they were going", async () => {
    const signUp = vi.fn().mockResolvedValue({
      data: { session: { access_token: "token" }, user: { id: userId } },
      error: null,
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { signUp } });
    const { signupAction } = await import("@/app/signup/actions");

    await expect(
      signupAction(
        signupState,
        formData({
          email: "Fan@Example.com ",
          password: "correct horse battery",
          displayName: " みお ",
          returnTo: `/invite/${token}`,
        }),
      ),
    ).rejects.toThrow(`REDIRECT:/invite/${token}`);

    expect(signUp).toHaveBeenCalledWith({
      email: "fan@example.com",
      password: "correct horse battery",
      options: {
        data: { display_name: "みお" },
        emailRedirectTo: `https://oshiwa.example.test/auth/confirm?next=${encodeURIComponent(`/invite/${token}`)}`,
      },
    });
  });

  it("says to check the inbox when the project still confirms addresses", async () => {
    const signUp = vi
      .fn()
      .mockResolvedValue({ data: { session: null, user: null }, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { signUp } });
    const { signupAction } = await import("@/app/signup/actions");

    const result = await signupAction(
      signupState,
      formData({
        email: "fan@example.com",
        password: "correct horse battery",
        displayName: "みお",
      }),
    );

    // Without a session there is nothing to walk into, and "welcome" would
    // strand them on a screen they cannot use.
    expect(result.status).toBe("confirm");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("refuses a short password before reaching Supabase", async () => {
    const signUp = vi.fn();
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { signUp } });
    const { signupAction } = await import("@/app/signup/actions");

    const result = await signupAction(
      signupState,
      formData({ email: "fan@example.com", password: "short", displayName: "みお" }),
    );

    expect(result.status).toBe("error");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("points an existing address at the login screen", async () => {
    const signUp = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: new Error("User already registered"),
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { signUp } });
    const { signupAction } = await import("@/app/signup/actions");

    const result = await signupAction(
      signupState,
      formData({
        email: "fan@example.com",
        password: "correct horse battery",
        displayName: "みお",
      }),
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("ログイン");
  });
});

describe("InvitePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderPage(value: string = token, user: unknown = { id: userId }) {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      },
    });
    const { default: InvitePage } = await import("@/app/invite/[token]/page");

    render(await InvitePage({ params: Promise.resolve({ token: value }) }));
  }

  it("offers to join, once, to somebody who is signed in", async () => {
    await renderPage();

    expect(
      screen.getByRole("button", { name: "この輪に参加する" }),
    ).toBeVisible();
    expect(screen.getByText(/一度きり/u)).toBeVisible();
  });

  it("sends a signed out visitor to log in and back to the link", async () => {
    await renderPage(token, null);

    expect(screen.getByRole("link", { name: "ログインして参加" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(`/invite/${token}`)}`,
    );
    expect(
      screen.getByRole("link", { name: "はじめての方はアカウントを作る" }),
    ).toHaveAttribute(
      "href",
      `/signup?returnTo=${encodeURIComponent(`/invite/${token}`)}`,
    );
  });

  it("never names the circle before somebody is in it", async () => {
    await renderPage();

    // Whoever holds this URL has not been let in yet, and the name of a
    // private circle is already something only its members should know.
    expect(document.body.textContent).not.toContain("推し会");
  });

  it("refuses a token that is not the right shape", async () => {
    await expect(renderPage("not-a-token")).rejects.toThrow("NOT_FOUND");
  });
});

describe("acceptJoinLinkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("takes the member into the circle the link belongs to", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: groupId, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const { acceptJoinLinkAction } = await import("@/app/invite/[token]/actions");

    await expect(
      acceptJoinLinkAction(acceptState, formData({ token })),
    ).rejects.toThrow(`REDIRECT:/groups/${groupId}/posts`);

    expect(rpc).toHaveBeenCalledWith("accept_group_join_link", {
      link_token: token,
    });
  });

  it("says the same thing however the link failed", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("Join link is invalid or unavailable"),
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const { acceptJoinLinkAction } = await import("@/app/invite/[token]/actions");

    const result = await acceptJoinLinkAction(acceptState, formData({ token }));

    expect(result.status).toBe("error");
    expect(result.message).not.toContain("invalid");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
