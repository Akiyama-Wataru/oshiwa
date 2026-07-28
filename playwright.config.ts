import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
      },
    },
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Never reuse a developer's server: it would run the suite against
    // whatever .env.local happens to hold, which silently changes which code
    // path is exercised.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Configured, but pointed at a closed port so every Supabase call fails
      // immediately. The suite then always exercises the configured, signed
      // out path instead of the "Supabase is missing" fallback, and it never
      // touches a real project.
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    },
  },
});
