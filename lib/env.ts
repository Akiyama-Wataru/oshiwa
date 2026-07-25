import { z } from "zod";

export type AppMode = "development" | "production" | "test";

export type SupabaseEnv =
  | {
      configured: false;
      url: null;
      publishableKey: null;
    }
  | {
      configured: true;
      url: string;
      publishableKey: string;
    };

export type SupabaseAdminEnv =
  | {
      configured: false;
      url: null;
      secretKey: null;
    }
  | {
      configured: true;
      url: string;
      secretKey: string;
    };

export class SupabaseConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SupabaseConfigurationError";
  }
}

const publicConfigSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const adminConfigSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
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
      throw new SupabaseConfigurationError(
        "Supabase configuration is required in production.",
      );
    }

    return {
      configured: false,
      url: null,
      publishableKey: null,
    };
  }

  if (!url || !publishableKey) {
    throw new SupabaseConfigurationError(
      "Supabase URL and publishable key must be configured together.",
    );
  }

  const parsed = publicConfigSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  });

  if (!parsed.success) {
    throw new SupabaseConfigurationError(
      "Supabase public configuration is invalid.",
      { cause: parsed.error },
    );
  }

  return {
    configured: true,
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function resolveSupabaseAdminEnv(
  env: Record<string, string | undefined>,
  mode: AppMode,
): SupabaseAdminEnv {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();

  if (!url && !secretKey) {
    if (mode === "production") {
      throw new SupabaseConfigurationError(
        "Supabase admin configuration is required in production.",
      );
    }

    return {
      configured: false,
      url: null,
      secretKey: null,
    };
  }

  if (!url || !secretKey) {
    throw new SupabaseConfigurationError(
      "Supabase URL and secret key must be configured together.",
    );
  }

  const parsed = adminConfigSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: secretKey,
  });

  if (!parsed.success) {
    throw new SupabaseConfigurationError(
      "Supabase admin configuration is invalid.",
      { cause: parsed.error },
    );
  }

  return {
    configured: true,
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: parsed.data.SUPABASE_SECRET_KEY,
  };
}
