import { expect, test } from "@playwright/test";

async function registeredScope(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;

    return registration.scope;
  });
}

test("アプリのどの入口からでもService Workerが登録される", async ({
  page,
  baseURL,
}) => {
  // A member who opens the app at their circle never passes the landing page.
  // If the worker were registered only there, the offline fallback would exist
  // for visitors and not for the people who use this every day.
  await page.goto("/login");

  await expect.poll(() => registeredScope(page)).toBe(`${baseURL}/`);
});

test("保護されたページは何もキャッシュに残さない", async ({ page }) => {
  await page.goto("/groups");
  await page.evaluate(() => navigator.serviceWorker.ready);

  const cachedPaths = async () =>
    page.evaluate(async () => {
      const names = await caches.keys();
      const entries: string[] = [];

      for (const name of names) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        entries.push(...keys.map((request) => new URL(request.url).pathname));
      }

      return entries.sort();
    });

  // The shell is all that may be kept. Personalised HTML, the auth routes and
  // the API must never survive on a shared or lost device.
  await expect.poll(cachedPaths).toEqual(
    [
      "/icons/apple-touch-icon.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
      "/manifest.webmanifest",
      "/offline.css",
      "/offline.html",
      "/offline.js",
    ].sort(),
  );
});
