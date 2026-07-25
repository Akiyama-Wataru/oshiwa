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
