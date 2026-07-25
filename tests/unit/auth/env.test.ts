import { describe, expect, it } from "vitest";

import {
  SupabaseConfigurationError,
  resolveSupabaseAdminEnv,
} from "@/lib/env";

describe("Supabase server environment validation", () => {
  it("allows imports and an unconfigured admin environment in test mode", () => {
    expect(resolveSupabaseAdminEnv({}, "test")).toEqual({
      configured: false,
      url: null,
      secretKey: null,
    });
  });

  it("requires the server-only secret key in production", () => {
    expect(() =>
      resolveSupabaseAdminEnv(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://oshiwa.supabase.co",
        },
        "production",
      ),
    ).toThrow(SupabaseConfigurationError);
  });

  it("accepts and trims a complete server-only configuration", () => {
    expect(
      resolveSupabaseAdminEnv(
        {
          NEXT_PUBLIC_SUPABASE_URL: " https://oshiwa.supabase.co ",
          SUPABASE_SECRET_KEY: " sb_secret_example ",
        },
        "test",
      ),
    ).toEqual({
      configured: true,
      url: "https://oshiwa.supabase.co",
      secretKey: "sb_secret_example",
    });
  });
});
