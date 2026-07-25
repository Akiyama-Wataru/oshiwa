import { describe, expect, it, vi } from "vitest";

vi.mock("vinext/server/app-router-entry", () => ({
  default: {
    fetch: vi.fn(),
  },
}));

vi.mock("vinext/server/image-optimization", () => ({
  DEFAULT_DEVICE_SIZES: [],
  DEFAULT_IMAGE_SIZES: [],
  handleImageOptimization: vi.fn(),
}));

import { withSecurityHeaders } from "@/worker/index";

describe("Cloudflare Worker security headers", () => {
  it("preserves the nonce CSP produced by the application proxy", async () => {
    const proxyCsp = [
      "default-src 'self'",
      "script-src 'self' 'nonce-request-123' 'strict-dynamic'",
      "connect-src 'self' https://project.supabase.co wss://project.supabase.co",
    ].join("; ");
    const source = new Response("ok", {
      headers: {
        "Content-Security-Policy": proxyCsp,
      },
    });

    const response = withSecurityHeaders(
      source,
      new Request("https://oshiwa.test/login"),
    );

    expect(response.headers.get("content-security-policy")).toBe(proxyCsp);
    expect(await response.text()).toBe("ok");
  });

  it("adds a conservative fallback only when the application supplied none", () => {
    const response = withSecurityHeaders(
      new Response("static"),
      new Request("https://oshiwa.test/manifest.webmanifest"),
    );
    const csp = response.headers.get("content-security-policy");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("*.supabase.co");
  });

  it("treats a blank CSP as absent instead of leaving the response unprotected", () => {
    const response = withSecurityHeaders(
      new Response("static", {
        headers: { "Content-Security-Policy": "   " },
      }),
      new Request("https://oshiwa.test/offline.html"),
    );
    const csp = response.headers.get("content-security-policy");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
  });
});
