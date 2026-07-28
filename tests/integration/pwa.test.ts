import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const manifestPath = resolve(process.cwd(), "public/manifest.webmanifest");
const workerPath = resolve(process.cwd(), "public/sw.js");

type WorkerListener = (event: Record<string, unknown>) => void;

async function currentCacheName() {
  const source = await readFile(workerPath, "utf8");
  const named = /const CACHE_NAME = "([^"]+)"/u.exec(source);

  if (!named) {
    throw new Error("the service worker no longer names its cache");
  }

  return named[1];
}

async function loadServiceWorker(existingCacheNames: string[] = []) {
  const source = await readFile(workerPath, "utf8");
  const listeners = new Map<string, WorkerListener>();
  const cachedUrls: string[] = [];
  const cache = {
    add: vi.fn(async (url: string | Request) => {
      cachedUrls.push(typeof url === "string" ? url : url.url);
    }),
    addAll: vi.fn(async (urls: Array<string | Request>) => {
      for (const url of urls) {
        cachedUrls.push(typeof url === "string" ? url : url.url);
      }
    }),
    match: vi.fn(async (): Promise<Response | undefined> => undefined),
    put: vi.fn(async () => undefined),
  };
  const caches = {
    delete: vi.fn(async () => true),
    keys: vi.fn(async () => existingCacheNames),
    match: vi.fn(async (): Promise<Response | undefined> => undefined),
    open: vi.fn(async () => cache),
  };
  const networkFetch = vi.fn(
    async () => new Response("network", { status: 200 }),
  );
  const serviceWorkerGlobal = {
    addEventListener: vi.fn((type: string, listener: WorkerListener) => {
      listeners.set(type, listener);
    }),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: "https://oshiwa.test" },
    skipWaiting: vi.fn(async () => undefined),
  };

  vm.runInNewContext(
    source,
    {
      URL,
      Request,
      Response,
      caches,
      console,
      fetch: networkFetch,
      self: serviceWorkerGlobal,
    },
    { filename: "public/sw.js" },
  );

  return {
    cache,
    cachedUrls,
    caches,
    listeners,
    networkFetch,
  };
}

describe("PWA manifest", () => {
  it("declares an installable standalone Japanese app", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(manifest).toMatchObject({
      name: "推し輪",
      short_name: "推し輪",
      display: "standalone",
      start_url: "/",
      lang: "ja",
      background_color: "#fff8ed",
      theme_color: "#f15f5a",
    });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("provides real 192px and 512px install icons", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    for (const size of ["192x192", "512x512"]) {
      const icon = manifest.icons.find(
        (candidate: { sizes?: string }) => candidate.sizes === size,
      );
      expect(icon).toMatchObject({
        sizes: size,
        type: "image/png",
      });
      expect(icon.src).toMatch(/^\/icons\/.+\.png$/);

      const iconFile = resolve(process.cwd(), `public${icon.src}`);
      expect((await stat(iconFile)).size).toBeGreaterThan(0);
    }
  });
});

describe("static-shell service worker", () => {
  it("pre-caches the shell and install metadata without private data routes", async () => {
    const { cachedUrls, listeners } = await loadServiceWorker();
    const install = listeners.get("install");
    expect(install).toBeTypeOf("function");

    let completed: Promise<unknown> | undefined;
    install?.({
      waitUntil(promise: Promise<unknown>) {
        completed = Promise.resolve(promise);
      },
    });
    await completed;

    const cachedPaths = cachedUrls.map(
      (entry) => new URL(entry, "https://oshiwa.test").pathname,
    );
    expect(cachedPaths).toEqual(
      expect.arrayContaining([
        "/offline.html",
        "/offline.css",
        "/offline.js",
        "/manifest.webmanifest",
      ]),
    );
    expect(cachedPaths).not.toContain("/");
    expect(cachedPaths.some((path) => path.startsWith("/icons/"))).toBe(true);
    expect(cachedPaths).not.toContain(
      expect.stringMatching(/^\/(?:api|auth)(?:\/|$)/),
    );
  });

  it("deletes only obsolete cache entries owned by 推し輪", async () => {
    // Read from the worker rather than written out here: the name changes with
    // every shell correction, and a test that has to be edited alongside it
    // would only ever be edited to agree.
    const cacheName = await currentCacheName();
    const { caches, listeners } = await loadServiceWorker([
      "oshiwa-shell-v0",
      cacheName,
      "unrelated-draft-cache",
    ]);
    const activate = listeners.get("activate");
    expect(activate).toBeTypeOf("function");

    let completed: Promise<unknown> | undefined;
    activate?.({
      waitUntil(promise: Promise<unknown>) {
        completed = Promise.resolve(promise);
      },
    });
    await completed;

    expect(caches.delete).toHaveBeenCalledTimes(1);
    expect(caches.delete).toHaveBeenCalledWith("oshiwa-shell-v0");
    expect(caches.delete).not.toHaveBeenCalledWith("unrelated-draft-cache");
  });

  it("serves the offline page assets from the public shell cache", async () => {
    const { caches, listeners, networkFetch } = await loadServiceWorker();
    const cachedStyles = new Response("cached styles", {
      headers: { "content-type": "text/css" },
    });
    caches.match.mockResolvedValueOnce(cachedStyles);
    const fetchListener = listeners.get("fetch");
    const respondWith = vi.fn();

    fetchListener?.({
      request: new Request("https://oshiwa.test/offline.css"),
      respondWith,
    });

    expect(respondWith).toHaveBeenCalledTimes(1);
    const response = await respondWith.mock.calls[0]?.[0];
    expect(await response.text()).toBe("cached styles");
    expect(caches.match).toHaveBeenCalled();
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["same-origin private API", "https://oshiwa.test/api/groups"],
    [
      "Supabase REST data",
      "https://project.supabase.co/rest/v1/private_posts",
    ],
    [
      "Supabase authentication",
      "https://project.supabase.co/auth/v1/token",
    ],
  ])("does not intercept or cache %s", async (_label, url) => {
    const { cache, caches, listeners } = await loadServiceWorker();
    const fetchListener = listeners.get("fetch");
    expect(fetchListener).toBeTypeOf("function");
    const respondWith = vi.fn();

    fetchListener?.({
      request: new Request(url),
      respondWith,
    });

    expect(respondWith).not.toHaveBeenCalled();
    expect(caches.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
});
