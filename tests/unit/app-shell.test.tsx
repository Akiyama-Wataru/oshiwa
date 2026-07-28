import type { Metadata } from "next";
import type { ReactElement } from "react";
import { isValidElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));

import { ServiceWorkerRegistration } from "@/app/components/ServiceWorkerRegistration";
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
  function carries(node: React.ReactNode, type: unknown): boolean {
    if (Array.isArray(node)) {
      return node.some((child) => carries(child, type));
    }

    if (!isValidElement(node)) {
      return false;
    }

    return (
      node.type === type ||
      carries(
        (node.props as { children?: React.ReactNode }).children,
        type,
      )
    );
  }

  it("registers the worker from the layout, not from one screen", () => {
    // Every page shares the layout, so a member who opens the app at their
    // circle gets a worker too. The registration's own behaviour is covered by
    // tests/unit/service-worker-registration.test.tsx, and by the browser
    // suite for what jsdom cannot show.
    expect(
      carries(RootLayout({ children: null }), ServiceWorkerRegistration),
    ).toBe(true);
    expect(carries(<Home />, ServiceWorkerRegistration)).toBe(false);
  });
});
