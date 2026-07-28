import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PostCard } from "@/app/components/posts/PostCard";
import { PostTimeline } from "@/app/components/posts/PostTimeline";
import type { PostAction } from "@/app/groups/[groupId]/posts/actions";
import type { TimelineEntry, TimelineOshi } from "@/lib/posts/timeline";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const postId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const oshiId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const basePath = `/groups/${groupId}/posts`;

const oshis: TimelineOshi[] = [{ id: oshiId, name: "ミナ", color: "#ff6f91" }];

const noop = vi.fn() as unknown as PostAction;
const actions = { attach: noop, detach: noop, remove: noop, update: noop };

function entry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: postId,
    body: "一曲目から\nよかった",
    createdAt: "2026-07-27T11:00:00+00:00",
    updatedAt: "2026-07-27T11:00:00+00:00",
    authorId: "4d2f6b18-2a70-4a1f-91b1-9d3a2c5e7f01",
    authorName: "みお",
    edited: false,
    images: [],
    oshis,
    hashtags: ["尊い"],
    canEdit: false,
    canRemove: false,
    ...overrides,
  };
}

function renderCard(overrides: Partial<TimelineEntry> = {}) {
  render(
    <PostCard
      actions={actions}
      basePath={basePath}
      entry={entry(overrides)}
      groupId={groupId}
      oshis={oshis}
    />,
  );
}

/** The management forms stay folded away until a member asks for them. */
function openManagePanel() {
  const panel = document.querySelector("details.post-manage-panel");

  if (!panel) {
    throw new Error("the card offered no management panel");
  }

  fireEvent.click(within(panel as HTMLElement).getByText("この投稿を管理"));
}

describe("PostCard", () => {
  it("keeps the line breaks the member typed", () => {
    renderCard();

    expect(screen.getByText(/一曲目から/)).toHaveTextContent(
      "一曲目から よかった",
    );
    expect(screen.getByText(/一曲目から/).textContent).toContain("\n");
  });

  it("renders the timestamp in a machine readable form as well", () => {
    renderCard();

    const time = screen.getByText("2026年7月27日 20:00");

    expect(time).toHaveAttribute("datetime", "2026-07-27T11:00:00+00:00");
  });

  it("says so when a post has been rewritten", () => {
    renderCard({ edited: true });

    expect(screen.getByText("編集済み")).toBeVisible();
  });

  it("turns each oshi and hashtag into a filter for the same timeline", () => {
    renderCard();

    expect(screen.getByRole("link", { name: "ミナ" })).toHaveAttribute(
      "href",
      `${basePath}?oshi=${oshiId}`,
    );
    expect(screen.getByRole("link", { name: "#尊い" })).toHaveAttribute(
      "href",
      `${basePath}?tag=%E5%B0%8A%E3%81%84`,
    );
  });

  it("describes each photo instead of leaving the alt text empty", () => {
    renderCard({
      images: [
        {
          imagePath: `${groupId}/${postId}/${"a".repeat(32)}.webp`,
          imageUrl: "https://example.test/a",
        },
      ],
    });

    expect(screen.getByAltText("みおの投稿の写真1枚目")).toHaveAttribute(
      "src",
      "https://example.test/a",
    );
  });

  it("says a photo is missing rather than showing a broken image", () => {
    renderCard({
      images: [
        {
          imagePath: `${groupId}/${postId}/${"a".repeat(32)}.webp`,
          imageUrl: null,
        },
      ],
    });

    expect(screen.getByText("写真を読み込めませんでした。")).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("offers no management at all to a plain reader", () => {
    renderCard();

    expect(screen.queryByText("この投稿を管理")).toBeNull();
  });

  it("lets the author rewrite and manage the photos", () => {
    renderCard({ canEdit: true, canRemove: true });
    openManagePanel();

    expect(screen.getByText("この投稿を管理")).toBeVisible();
    expect(screen.getByRole("button", { name: "投稿を更新" })).toBeVisible();
    expect(screen.getByRole("button", { name: "写真を追加" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "みおの投稿を削除" }),
    ).toBeVisible();
  });

  it("gives a manager the removal but never the rewrite", () => {
    renderCard({ canEdit: false, canRemove: true });
    openManagePanel();

    expect(screen.queryByRole("button", { name: "投稿を更新" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "みおの投稿を削除" }),
    ).toBeVisible();
  });

  it("preselects the oshis and hashtags the post already carries", () => {
    renderCard({ canEdit: true, canRemove: true });
    openManagePanel();

    expect(screen.getByLabelText("ミナ")).toBeChecked();
    expect(screen.getByDisplayValue("#尊い")).toBeVisible();
  });
});

describe("PostTimeline", () => {
  function renderTimeline(options: {
    entries?: TimelineEntry[];
    isFilteredPage?: boolean;
    nextCursor?: string | null;
  }) {
    render(
      <PostTimeline
        actions={actions}
        activeOshiId={oshiId}
        activeTag={null}
        basePath={basePath}
        entries={options.entries ?? [entry()]}
        groupId={groupId}
        isFilteredPage={options.isFilteredPage ?? false}
        nextCursor={options.nextCursor ?? null}
        oshis={oshis}
      />,
    );
  }

  it("invites the first post when the group has none", () => {
    renderTimeline({ entries: [] });

    expect(screen.getByText("まだ投稿がありません。")).toBeVisible();
    expect(screen.queryByRole("link", { name: "絞り込みを解除" })).toBeNull();
  });

  it("offers a way back when a filter emptied the timeline", () => {
    renderTimeline({ entries: [], isFilteredPage: true });

    expect(screen.getByText("この条件に合う投稿はありません。")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "絞り込みを解除" }),
    ).toHaveAttribute("href", basePath);
  });

  it("carries the active filter into the link to the older page", () => {
    renderTimeline({
      nextCursor: `2026-07-27T11:00:00+00:00_${postId}`,
    });

    const more = screen.getByRole("link", { name: "古い投稿を見る" });

    expect(more.getAttribute("href")).toContain(`oshi=${oshiId}`);
    expect(more.getAttribute("href")).toContain("before=");
  });

  it("omits the older page link once the page is short", () => {
    renderTimeline({ nextCursor: null });

    expect(screen.queryByRole("link", { name: "古い投稿を見る" })).toBeNull();
    expect(screen.getByRole("list", { name: "タイムライン" }).children).toHaveLength(
      1,
    );
  });
});
