"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type AppMode,
  SupabaseConfigurationError,
  resolveSupabaseEnv,
} from "@/lib/env";

type BrowserClientFactory<TClient> = (
  url: string,
  publishableKey: string,
  options: { isSingleton: true },
) => TClient;

export type BrowserSupabaseClientDependencies<TClient> = {
  createClient?: BrowserClientFactory<TClient>;
  env?: Record<string, string | undefined>;
  mode?: AppMode;
};

let browserClient: unknown;

function runtimePublicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function createBrowserSupabaseClient<
  TClient = SupabaseClient,
>(
  dependencies: BrowserSupabaseClientDependencies<TClient> = {},
): TClient {
  if (browserClient) {
    return browserClient as TClient;
  }

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

  const factory =
    dependencies.createClient ??
    ((url, key, options) =>
      createBrowserClient(url, key, options) as TClient);

  browserClient = factory(config.url, config.publishableKey, {
    isSingleton: true,
  });

  return browserClient as TClient;
}
