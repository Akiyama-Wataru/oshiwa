import { describe, expect, it, vi } from "vitest";

type SupabaseEnv = {
  configured: boolean;
  url: string | null;
  publishableKey: string | null;
};

type EnvModule = {
  resolveSupabaseEnv(
    env: Record<string, string | undefined>,
    mode: "development" | "production" | "test",
  ): SupabaseEnv;
};

async function loadEnvModule() {
  const moduleId = "@/lib/env";
  return vi.importActual<EnvModule>(moduleId);
}

describe("Supabase public environment validation", () => {
  it("allows a local preview to render when Supabase is not configured", async () => {
    const { resolveSupabaseEnv } = await loadEnvModule();

    expect(resolveSupabaseEnv({}, "development")).toEqual({
      configured: false,
      url: null,
      publishableKey: null,
    });
  });

  it("returns a configured result when both public values are valid", async () => {
    const { resolveSupabaseEnv } = await loadEnvModule();

    expect(
      resolveSupabaseEnv(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://oshiwa.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
        },
        "development",
      ),
    ).toEqual({
      configured: true,
      url: "https://oshiwa.supabase.co",
      publishableKey: "sb_publishable_example",
    });
  });

  it("rejects partial configuration instead of silently misconfiguring auth", async () => {
    const { resolveSupabaseEnv } = await loadEnvModule();

    expect(() =>
      resolveSupabaseEnv(
        { NEXT_PUBLIC_SUPABASE_URL: "https://oshiwa.supabase.co" },
        "development",
      ),
    ).toThrow(/Supabase.*together/i);
  });

  it("requires Supabase configuration in production", async () => {
    const { resolveSupabaseEnv } = await loadEnvModule();

    expect(() => resolveSupabaseEnv({}, "production")).toThrow(
      /Supabase.*required/i,
    );
  });
});
