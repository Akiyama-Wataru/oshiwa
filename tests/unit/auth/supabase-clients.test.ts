import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://oshiwa.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
};

describe("Supabase client factories", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("creates a request-scoped server client with getAll/setAll cookies", async () => {
    const { createServerSupabaseClient } = await import(
      "@/lib/supabase/server"
    );
    const cookieStore = {
      getAll: vi.fn(() => [{ name: "session", value: "old" }]),
      set: vi.fn(),
    };
    const clients = [{ request: 1 }, { request: 2 }];
    const createClient = vi
      .fn()
      .mockReturnValueOnce(clients[0])
      .mockReturnValueOnce(clients[1]);
    const dependencies = {
      createClient,
      getCookieStore: vi.fn(async () => cookieStore),
      env: publicEnv,
      mode: "test" as const,
    };

    const first = await createServerSupabaseClient(dependencies);
    const second = await createServerSupabaseClient(dependencies);

    expect(first).toBe(clients[0]);
    expect(second).toBe(clients[1]);
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(dependencies.getCookieStore).toHaveBeenCalledTimes(2);

    const options = createClient.mock.calls[0]?.[2];
    expect(options.cookies.getAll()).toEqual([
      { name: "session", value: "old" },
    ]);
    options.cookies.setAll([
      {
        name: "session",
        value: "new",
        options: { httpOnly: true, sameSite: "lax" },
      },
      {
        name: "refresh",
        value: "next",
        options: { httpOnly: true, sameSite: "lax" },
      },
    ]);
    expect(cookieStore.set).toHaveBeenCalledTimes(2);
  });

  it("returns one browser singleton and never reads a server secret", async () => {
    const { createBrowserSupabaseClient } = await import(
      "@/lib/supabase/client"
    );
    const browserClient = { auth: {} };
    const createClient = vi.fn(() => browserClient);
    const dependencies = {
      createClient,
      env: {
        ...publicEnv,
        SUPABASE_SECRET_KEY: "must-not-be-forwarded",
      },
      mode: "test" as const,
    };

    expect(createBrowserSupabaseClient(dependencies)).toBe(browserClient);
    expect(createBrowserSupabaseClient(dependencies)).toBe(browserClient);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      expect.objectContaining({ isSingleton: true }),
    );
    expect(JSON.stringify(createClient.mock.calls)).not.toContain(
      "must-not-be-forwarded",
    );
  });

  it("creates a non-persistent server-only admin client", async () => {
    const { createAdminSupabaseClient } = await import(
      "@/lib/supabase/admin"
    );
    const adminClient = { auth: { admin: {} } };
    const createClient = vi.fn(() => adminClient);

    expect(
      createAdminSupabaseClient({
        createClient,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
          SUPABASE_SECRET_KEY: "sb_secret_example",
        },
        mode: "test",
      }),
    ).toBe(adminClient);
    expect(createClient).toHaveBeenCalledWith(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      "sb_secret_example",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
  });

  it("does not fail merely by importing factories without local Supabase env", async () => {
    await expect(import("@/lib/supabase/client")).resolves.toBeDefined();
    await expect(import("@/lib/supabase/server")).resolves.toBeDefined();
    await expect(import("@/lib/supabase/admin")).resolves.toBeDefined();
  });

  it("initializes each SDK with the production factory without network access", async () => {
    const { createBrowserSupabaseClient } = await import(
      "@/lib/supabase/client"
    );
    const browser = createBrowserSupabaseClient({
      env: publicEnv,
      mode: "test",
    });
    expect(browser.auth).toBeDefined();

    vi.resetModules();
    const { createAdminSupabaseClient } = await import(
      "@/lib/supabase/admin"
    );
    const admin = createAdminSupabaseClient({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
        SUPABASE_SECRET_KEY: "sb_secret_example",
      },
      mode: "test",
    });
    expect(admin.auth).toBeDefined();

    vi.resetModules();
    const { createServerSupabaseClient } = await import(
      "@/lib/supabase/server"
    );
    const server = await createServerSupabaseClient({
      env: publicEnv,
      getCookieStore: async () => ({
        getAll: () => [],
        set: () => undefined,
      }),
      mode: "test",
    });
    expect(server.auth).toBeDefined();
  });
});
