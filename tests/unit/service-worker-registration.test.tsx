import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceWorkerRegistration } from "@/app/components/ServiceWorkerRegistration";

function installServiceWorker(
  options: { failRegistration?: boolean; update?: () => Promise<void> } = {},
) {
  const update = vi.fn(options.update ?? (async () => undefined));
  const register = vi.fn(async () => {
    if (options.failRegistration) {
      throw new Error("registration unavailable");
    }

    return { update } as unknown as ServiceWorkerRegistration;
  });

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });

  return { register, update };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("ServiceWorkerRegistration", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    setVisibility("visible");
    vi.restoreAllMocks();
  });

  it("registers the worker once", async () => {
    const { register } = installServiceWorker();

    render(<ServiceWorkerRegistration />);

    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js"));
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("looks for a new version when the app is brought back", async () => {
    const { update } = installServiceWorker();

    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(update).not.toHaveBeenCalled());

    // An installed app can stay open for days. Without this it would keep
    // serving the shell it cached on the day it was installed.
    setVisibility("visible");

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it("does not look while the app is out of sight", async () => {
    const { update } = installServiceWorker();

    render(<ServiceWorkerRegistration />);
    setVisibility("hidden");

    await waitFor(() => expect(update).not.toHaveBeenCalled());
  });

  it("stays out of the way when the worker cannot be registered", async () => {
    const { register } = installServiceWorker({ failRegistration: true });

    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();

    await waitFor(() => expect(register).toHaveBeenCalled());
    setVisibility("visible");
  });

  it("survives a browser without service workers at all", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");

    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
  });
});
