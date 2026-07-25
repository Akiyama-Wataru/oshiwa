import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  config,
  handleAuthProxy,
  isAuthProxyPath,
  proxy,
} from "@/proxy";

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://oshiwa.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authentication proxy", () => {
  it("uses getClaims, forwards every refreshed cookie, and marks groups private", async () => {
    const getClaims = vi.fn(async () => ({
      data: { claims: { sub: "user-1" } },
      error: null,
    }));
    const createClient = vi.fn((_url, _key, options) => ({
      auth: {
        getClaims: async () => {
          options.cookies.setAll([
            {
              name: "sb-access",
              value: "access-next",
              options: { httpOnly: true, path: "/", sameSite: "lax" },
            },
            {
              name: "sb-refresh",
              value: "refresh-next",
              options: { httpOnly: true, path: "/", sameSite: "lax" },
            },
          ]);
          return getClaims();
        },
      },
    }));
    const request = new NextRequest("https://oshiwa.test/groups/friends", {
      headers: { cookie: "sb-access=access-old; theme=coral" },
    });

    const response = await handleAuthProxy(request, {
      createClient,
      createNonce: () => "11111111-2222-4333-8444-555555555555",
      env: publicEnv,
      mode: "test",
    });

    expect(response.status).toBe(200);
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      expect.objectContaining({
        cookies: expect.objectContaining({
          getAll: expect.any(Function),
          setAll: expect.any(Function),
        }),
      }),
    );
    expect(createClient.mock.calls[0]?.[2].cookies.getAll()).toEqual(
      expect.arrayContaining([
        { name: "sb-access", value: "access-next" },
        { name: "theme", value: "coral" },
      ]),
    );
    expect(response.cookies.getAll()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "sb-access", value: "access-next" }),
        expect.objectContaining({ name: "sb-refresh", value: "refresh-next" }),
      ]),
    );
    expect(response.headers.get("cache-control")).toMatch(/private/i);
    expect(response.headers.get("cache-control")).toMatch(/no-store/i);
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain(
      "script-src 'self' 'nonce-11111111-2222-4333-8444-555555555555' 'strict-dynamic'",
    );
    expect(csp).toContain(
      "connect-src 'self' https://oshiwa.supabase.co wss://oshiwa.supabase.co",
    );
    expect(csp).not.toContain("*.supabase.co");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(response.headers.get("x-nonce")).toBeNull();
  });

  it("passes the per-request nonce CSP to the request and middleware response", async () => {
    const createClient = vi.fn(() => ({
      auth: {
        getClaims: vi.fn(async () => ({
          data: { claims: { sub: "user-1" } },
          error: null,
        })),
      },
    }));
    const response = await handleAuthProxy(
      new NextRequest("https://oshiwa.test/groups"),
      {
        createClient,
        createNonce: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        env: publicEnv,
        mode: "test",
      },
    );

    const expectedNonce = "'nonce-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'";
    expect(
      response.headers.get(
        "x-middleware-request-content-security-policy",
      ),
    ).toContain(expectedNonce);
    expect(response.headers.get("content-security-policy")).toContain(
      expectedNonce,
    );
  });

  it("redirects missing claims to login with a safe returnTo", async () => {
    const createClient = vi.fn(() => ({
      auth: {
        getClaims: vi.fn(async () => ({
          data: { claims: null },
          error: { message: "invalid jwt" },
        })),
      },
    }));
    const request = new NextRequest(
      "https://oshiwa.test/groups/friends?tab=members",
    );

    const response = await handleAuthProxy(request, {
      createClient,
      env: publicEnv,
      mode: "test",
    });

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://oshiwa.test");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toBe(
      "/groups/friends?tab=members",
    );
    expect(response.headers.get("cache-control")).toMatch(/no-store/i);
  });

  it("fails closed on protected paths when Supabase is unavailable", async () => {
    const createClient = vi.fn(() => ({
      auth: {
        getClaims: vi.fn(async () => {
          throw new TypeError("network internals");
        }),
      },
    }));

    const response = await handleAuthProxy(
      new NextRequest("https://oshiwa.test/groups"),
      { createClient, env: publicEnv, mode: "test" },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://oshiwa.test/login?returnTo=%2Fgroups",
    );
  });

  it("lets public pages render when Supabase is intentionally unconfigured", async () => {
    const createClient = vi.fn();

    const response = await handleAuthProxy(
      new NextRequest("https://oshiwa.test/login"),
      {
        createClient,
        createNonce: () => "no-supabase-nonce",
        env: {},
        mode: "test",
      },
    );

    expect(response.status).toBe(200);
    expect(createClient).not.toHaveBeenCalled();
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(response.headers.get("content-security-policy")).not.toContain(
      "supabase.co",
    );
  });

  it("marks token-bearing join HTML private without auth-gating it", async () => {
    const createClient = vi.fn();
    const token = "a".repeat(64);

    const response = await handleAuthProxy(
      new NextRequest(`https://oshiwa.test/join/${token}?setup=1`),
      {
        createClient,
        createNonce: () => "private-join-nonce",
        env: {},
        mode: "test",
      },
    );

    expect(response.status).toBe(200);
    expect(createClient).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toMatch(/private/i);
    expect(response.headers.get("cache-control")).toMatch(/no-store/i);
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("keeps the token-free join introduction publicly cache-neutral", async () => {
    const response = await handleAuthProxy(
      new NextRequest("https://oshiwa.test/join"),
      { createClient: vi.fn(), env: {}, mode: "test" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
  });

  it("lets public production routes render when both Supabase values are absent", async () => {
    const createClient = vi.fn();

    const response = await handleAuthProxy(
      new NextRequest("https://oshiwa.test/login"),
      {
        createClient,
        createNonce: () => "production-public-nonce",
        env: {},
        mode: "production",
      },
    );

    expect(response.status).toBe(200);
    expect(createClient).not.toHaveBeenCalled();
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(response.headers.get("content-security-policy")).not.toContain(
      "supabase.co",
    );
  });

  it("fails closed without initializing Supabase on protected production routes", async () => {
    const createClient = vi.fn();

    const response = await handleAuthProxy(
      new NextRequest("https://oshiwa.test/groups/friends"),
      {
        createClient,
        createNonce: () => "production-protected-nonce",
        env: {},
        mode: "production",
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://oshiwa.test/login?returnTo=%2Fgroups%2Ffriends",
    );
    expect(response.headers.get("cache-control")).toMatch(/no-store/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("redirects protected local previews when Supabase is unconfigured", async () => {
    const response = await handleAuthProxy(
      new NextRequest("https://oshiwa.test/groups"),
      { createClient: vi.fn(), env: {}, mode: "test" },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://oshiwa.test/login?returnTo=%2Fgroups",
    );
  });

  it.each([
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/manifest.webmanifest",
    "/sw.js",
    "/offline.html",
    "/icons/icon-192.png",
  ])("excludes static and PWA assets from auth work: %s", (pathname) => {
    expect(isAuthProxyPath(pathname)).toBe(false);
  });

  it("exports a statically analyzable matcher and protects only /groups routes", () => {
    expect(config.matcher).toEqual([expect.any(String)]);
    expect(isAuthProxyPath("/groups")).toBe(true);
    expect(isAuthProxyPath("/groups/friends")).toBe(true);
    expect(isAuthProxyPath("/groups-public")).toBe(false);
  });

  it("supports the production proxy entrypoint without a configured local backend", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const response = await proxy(
      new NextRequest("https://oshiwa.test/groups"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("content-security-policy")).toContain(
      "'nonce-",
    );
  });
});
