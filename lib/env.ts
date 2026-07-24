import { z } from "zod";

export type AppMode = "development" | "production" | "test";

export type SupabaseEnv = {
  configured: boolean;
  url: string | null;
  publishableKey: string | null;
};

const publicConfigSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export function resolveSupabaseEnv(
  env: Record<string, string | undefined>,
  mode: AppMode,
): SupabaseEnv {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url && !publishableKey) {
    if (mode === "production") {
      throw new Error("Supabase configuration is required in production.");
    }

    return {
      configured: false,
      url: null,
      publishableKey: null,
    };
  }

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase URL and publishable key must be configured together.",
    );
  }

  const parsed = publicConfigSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  });

  return {
    configured: true,
    url: parsed.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}
