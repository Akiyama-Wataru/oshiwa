import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pagePath = resolve(process.cwd(), "public/offline.html");
const scriptPath = resolve(process.cwd(), "public/offline.js");

async function renderOfflinePage(options: { online: boolean }) {
  const [markup, script] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(scriptPath, "utf8"),
  ]);

  document.documentElement.innerHTML = markup
    .replace(/[\s\S]*<html[^>]*>/u, "")
    .replace(/<\/html>[\s\S]*/u, "");

  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => options.online,
  });

  // The file is plain script, served as it is written: no bundler stands
  // between it and the browser, so it is run here exactly as shipped.
  new Function(script)();

  return {
    heading: () => document.querySelector("h1")?.textContent ?? "",
    detail: () => document.getElementById("offline-detail")?.textContent ?? "",
  };
}

describe("the offline page", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blames the connection only when the device has actually lost it", async () => {
    const page = await renderOfflinePage({ online: false });

    expect(page.heading()).toContain("オフライン");
  });

  it("says the app could not be reached when the device is online", async () => {
    const page = await renderOfflinePage({ online: true });

    // Telling somebody they are offline while their connection is fine sends
    // them to check their wifi when nothing is wrong with it.
    expect(page.heading()).not.toContain("オフライン");
    expect(page.heading()).toContain("接続できませんでした");
    expect(page.detail()).toContain("時間をおいて");
  });

  it("claims neither cause before its script has run", async () => {
    const markup = await readFile(pagePath, "utf8");

    expect(markup).not.toContain("いまはオフラインです");
    expect(markup).toContain("ページを開けませんでした");
  });

  it("corrects itself when the connection comes back", async () => {
    const page = await renderOfflinePage({ online: false });

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
    window.dispatchEvent(new Event("online"));

    expect(page.heading()).not.toContain("オフライン");
  });

  it("offers a way to try again", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload },
    });

    await renderOfflinePage({ online: true });
    document.getElementById("retry")?.dispatchEvent(new Event("click"));

    expect(reload).toHaveBeenCalled();
  });
});
