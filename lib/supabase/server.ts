import "server-only";

import {
  createServerClient,
  type CookieOptions,
  type CookieMethodsServer,
} from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  type AppMode,
  SupabaseConfigurationError,
  resolveSupabaseEnv,
} from "@/lib/env";

type CookieStore = {
  getAll(): Array<{ name: string; value: string }>;
  set(name: string, value: string, options?: CookieOptions): unknown;
};

type ServerClientOptions = {
  cookies: CookieMethodsServer;
};

type ServerClientFactory<TClient> = (
  url: string,
  publishableKey: string,
  options: ServerClientOptions,
) => TClient;

export type ServerSupabaseClientDependencies<TClient> = {
  createClient?: ServerClientFactory<TClient>;
  env?: Record<string, string | undefined>;
  getCookieStore?: () => Promise<CookieStore>;
  mode?: AppMode;
};

function runtimePublicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export async function createServerSupabaseClient<
  TClient = SupabaseClient,
>(
  dependencies: ServerSupabaseClientDependencies<TClient> = {},
): Promise<TClient> {
  const mode = dependencies.mode ?? process.env.NODE_ENV;
  const config = resolveSupabaseEnv(
    dependencies.env ?? runtimePublicEnv(),
    mode,
  );

  if (!config.configured) {
    throw new SupabaseConfigurationError(
      "Supabase is not configured for this environment.",
    );
  }

  const cookieStore = await (
    dependencies.getCookieStore ??
    (cookies as unknown as () => Promise<CookieStore>)
  )();
  const factory =
    dependencies.createClient ??
    ((url, key, options) =>
      createServerClient(url, key, options) as TClient);

  return factory(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Server Components cannot mutate cookies. Proxy/Server Actions
            // perform the write when the current request context allows it.
          }
        }
      },
    },
  });
}
