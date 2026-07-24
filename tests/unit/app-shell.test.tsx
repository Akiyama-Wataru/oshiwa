import type { Metadata } from "next";
import type { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));

import RootLayout, { metadata } from "@/app/layout";
import Home, * as homeModule from "@/app/page";

const expectedDescription =
  "好きな気持ちを、身内だけで。招待制のプライベート推し活コミュニティ";

describe("Japanese root metadata", () => {
  it("identifies the app in Japanese and links the PWA manifest", () => {
    expect(metadata).toMatchObject({
      title: "推し輪",
      description: expectedDescription,
      manifest: "/manifest.webmanifest",
    });

    const root = RootLayout({
      children: <span>content</span>,
    }) as ReactElement<{ lang: string }>;
    expect(root.type).toBe("html");
    expect(root.props.lang).toBe("ja");
  });

  it("does not expose the disposable Codex preview marker", () => {
    const pageMetadata = (homeModule as { metadata?: Metadata }).metadata;

    expect(metadata.other?.["codex-preview"]).toBeUndefined();
    expect(pageMetadata?.other?.["codex-preview"]).toBeUndefined();
  });
});

describe("accessible app shell", () => {
  it("presents the brand, promise, invite policy, and primary sign-in action", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "推し輪" }),
    ).toBeVisible();
    expect(
      screen.getByText("好きな気持ちを、身内だけで。"),
    ).toBeVisible();
    expect(screen.getByText(/招待された方のみ参加できます/)).toBeVisible();

    const signIn = screen.getByRole("link", { name: /ログイン/ });
    expect(signIn).toHaveAttribute("href", "/login");
    expect(screen.getByRole("main")).toContainElement(signIn);
  });

  it("describes the static product preview without exposing fake controls", () => {
    render(<Home />);

    expect(
      screen.getByRole("img", {
        name: "推し輪のタイムライン画面イメージ",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("marks English phrases for correct screen-reader pronunciation", () => {
    render(<Home />);

    expect(screen.getByText("PRIVATE FAN COMMUNITY")).toHaveAttribute(
      "lang",
      "en",
    );
    expect(screen.getByText("SMALL CIRCLE, BIG LOVE")).toHaveAttribute(
      "lang",
      "en",
    );
  });
});

describe("service worker registration", () => {
  const originalServiceWorker = navigator.serviceWorker;

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
  });

  it("registers the static-shell worker when the browser supports it", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    render(<Home />);

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith("/sw.js");
    });
  });
});
