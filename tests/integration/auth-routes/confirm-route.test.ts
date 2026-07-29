import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerSupabaseClient } = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient,
}));

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies only invite OTPs and returns a same-origin 303 without caching", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    createServerSupabaseClient.mockResolvedValue({ auth: { verifyOtp } });
    const { GET } = await import("@/app/auth/confirm/route");
    const tokenHash = "a".repeat(64);

    const response = await GET(
      new Request(
        `https://oshiwa.test/auth/confirm?type=invite&token_hash=${tokenHash}&next=%2Fjoin%2F${"b".repeat(64)}`,
      ),
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "invite",
      token_hash: tokenHash,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://oshiwa.test/join/${"b".repeat(64)}`,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("verifies a sign up confirmation and lands where the member was heading", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    createServerSupabaseClient.mockResolvedValue({ auth: { verifyOtp } });
    const { GET } = await import("@/app/auth/confirm/route");
    const tokenHash = "c".repeat(64);
    const next = `/invite/${"d".repeat(64)}`;

    const response = await GET(
      new Request(
        `https://oshiwa.test/auth/confirm?type=signup&token_hash=${tokenHash}&next=${encodeURIComponent(next)}`,
      ),
    );

    // Anybody can register now, so this is an ordinary arrival rather than a
    // link that should be treated as a mistake.
    expect(verifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: tokenHash,
    });
    expect(response.headers.get("location")).toBe(
      `https://oshiwa.test${next}`,
    );
  });

  it("tells a new member their own link expired, not that an invitation did", async () => {
    createServerSupabaseClient.mockResolvedValue({
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({ error: new Error("expired") }),
      },
    });
    const { GET } = await import("@/app/auth/confirm/route");

    const response = await GET(
      new Request(
        `https://oshiwa.test/auth/confirm?type=signup&token_hash=${"e".repeat(64)}`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://oshiwa.test/login?status=signup-confirmation-failed",
    );
  });

  it("accepts a same-origin absolute join URL and preserves query and hash", async () => {
    createServerSupabaseClient.mockResolvedValue({
      auth: { verifyOtp: vi.fn().mockResolvedValue({ error: null }) },
    });
    const { GET } = await import("@/app/auth/confirm/route");
    const destination = `https://oshiwa.test/join/${"d".repeat(64)}?setup=1#password`;

    const response = await GET(
      new Request(
        `https://oshiwa.test/auth/confirm?type=invite&token_hash=${"a".repeat(64)}&next=${encodeURIComponent(destination)}`,
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(destination);
  });

  it.each([
    "https://evil.example/steal",
    `https://evil.example/join/${"b".repeat(64)}?setup=1`,
    `https://user:password@oshiwa.test/join/${"b".repeat(64)}`,
    "//evil.example/steal",
    "javascript:alert(1)",
    `https://oshiwa.test/join/${"z".repeat(64)}`,
  ])("never redirects off origin for %s", async (next) => {
    createServerSupabaseClient.mockResolvedValue({
      auth: { verifyOtp: vi.fn().mockResolvedValue({ error: null }) },
    });
    const { GET } = await import("@/app/auth/confirm/route");

    const response = await GET(
      new Request(
        `https://oshiwa.test/auth/confirm?type=invite&token_hash=${"a".repeat(64)}&next=${encodeURIComponent(next)}`,
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://oshiwa.test/groups",
    );
  });

  it("verifies a recovery OTP and lands on the password form", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    createServerSupabaseClient.mockResolvedValue({ auth: { verifyOtp } });
    const { GET } = await import("@/app/auth/confirm/route");
    const tokenHash = "c".repeat(64);

    const response = await GET(
      new Request(
        `https://oshiwa.test/auth/confirm?type=recovery&token_hash=${tokenHash}&next=%2Fgroups`,
      ),
    );

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token_hash: tokenHash,
    });
    // The destination is fixed rather than read from `next`: a recovery link
    // is only ever on its way to the form that sets the new password.
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://oshiwa.test/password/update",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("sends a failed recovery back to the reset form, not the login form", async () => {
    createServerSupabaseClient.mockResolvedValue({
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({ error: new Error("expired") }),
      },
    });
    const { GET } = await import("@/app/auth/confirm/route");

    const response = await GET(
      new Request(
        `https://oshiwa.test/auth/confirm?type=recovery&token_hash=${"d".repeat(64)}`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://oshiwa.test/password/reset?status=link-expired",
    );
  });

  it("rejects an invalid type or token without calling Supabase", async () => {
    const verifyOtp = vi.fn();
    createServerSupabaseClient.mockResolvedValue({ auth: { verifyOtp } });
    const { GET } = await import("@/app/auth/confirm/route");

    const response = await GET(
      new Request(
        "https://oshiwa.test/auth/confirm?type=signup&token_hash=short",
      ),
    );

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://oshiwa.test/login?status=confirmation-failed",
    );
  });

  it("generalizes verification failures without echoing the token", async () => {
    createServerSupabaseClient.mockResolvedValue({
      auth: {
        verifyOtp: vi
          .fn()
          .mockResolvedValue({ error: new Error("expired token details") }),
      },
    });
    const { GET } = await import("@/app/auth/confirm/route");
    const tokenHash = "c".repeat(64);

    const response = await GET(
      new Request(
        `https://oshiwa.test/auth/confirm?type=invite&token_hash=${tokenHash}`,
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://oshiwa.test/login?status=confirmation-failed",
    );
    expect(response.headers.get("location")).not.toContain(tokenHash);
  });
});
