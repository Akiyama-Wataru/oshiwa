import "server-only";

import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";

import {
  type AppMode,
  SupabaseConfigurationError,
  resolveSupabaseAdminEnv,
} from "@/lib/env";

type AdminClientFactory<TClient> = (
  url: string,
  secretKey: string,
  options: SupabaseClientOptions<"public">,
) => TClient;

export type AdminSupabaseClientDependencies<TClient> = {
  createClient?: AdminClientFactory<TClient>;
  env?: Record<string, string | undefined>;
  mode?: AppMode;
};

function runtimeAdminEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  };
}

export function createAdminSupabaseClient<
  TClient = SupabaseClient,
>(
  dependencies: AdminSupabaseClientDependencies<TClient> = {},
): TClient {
  const mode = dependencies.mode ?? process.env.NODE_ENV;
  const config = resolveSupabaseAdminEnv(
    dependencies.env ?? runtimeAdminEnv(),
    mode,
  );

  if (!config.configured) {
    throw new SupabaseConfigurationError(
      "Supabase admin access is not configured for this environment.",
    );
  }

  const factory =
    dependencies.createClient ??
    ((url, key, options) => createClient(url, key, options) as TClient);

  return factory(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
