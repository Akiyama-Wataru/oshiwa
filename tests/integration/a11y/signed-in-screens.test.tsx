import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { MemberRoster } from "@/app/components/members/MemberRoster";
import { PostCard } from "@/app/components/posts/PostCard";
import type { PostAction } from "@/app/groups/[groupId]/posts/actions";
import type { RosterMember } from "@/lib/members/roster";
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
const replyId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const oshiId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const memberId = "4d2f6b18-2a70-4a1f-91b1-9d3a2c5e7f01";
const viewerId = "5e3a7c29-3b81-4b2f-82c2-8e4b3d6f8a12";
const basePath = `/groups/${groupId}/posts`;

const noop = vi.fn() as unknown as PostAction;
const actions = {
  attach: noop,
  detach: noop,
  remove: noop,
  update: noop,
  reactions: {
    like: noop,
    reply: noop,
    removeReply: noop,
    share: noop,
    unshare: noop,
  },
};

const oshis: TimelineOshi[] = [{ id: oshiId, name: "ミナ", color: "#ff6f91" }];

/**
 * The screens behind a session, which the browser suite cannot reach: it has no
 * way to sign in, so a check there would silently run against a login form.
 * jsdom has no layout, so contrast and target size are left to the browser
 * suite; everything structural is decided here.
 */
async function violations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
    },
    rules: {
      "color-contrast": { enabled: false },
      "target-size": { enabled: false },
    },
  });

  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.html),
  }));
}

function entry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: postId,
    body: "一曲目からよかった",
    createdAt: "2026-07-27T11:00:00+00:00",
    updatedAt: "2026-07-27T11:00:00+00:00",
    authorId: memberId,
    authorName: "みお",
    edited: false,
    images: [
      {
        imagePath: `${groupId}/${postId}/${"a".repeat(32)}.webp`,
        imageUrl: "https://example.test/a",
      },
    ],
    oshis,
    hashtags: ["尊い"],
    canEdit: true,
    canRemove: true,
    likeCount: 2,
    likedByViewer: true,
    replies: [
      {
        id: replyId,
        body: "行きたかった",
        createdAt: "2026-07-27T11:30:00+00:00",
        authorId: viewerId,
        authorName: "はな",
        canRemove: true,
      },
    ],
    replyCount: 4,
    shares: [
      {
        id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
        note: "これ見て",
        createdAt: "2026-07-27T12:00:00+00:00",
        sharerId: memberId,
        sharerName: "はな",
        isViewer: false,
      },
    ],
    shareCount: 1,
    sharedByViewer: false,
    ...overrides,
  };
}

const roster: RosterMember[] = [
  {
    userId: memberId,
    role: "owner",
    displayName: "おーな",
    isSelf: false,
    canChangeRole: true,
    canRemove: true,
  },
  {
    userId: viewerId,
    role: "member",
    displayName: "めんばー",
    isSelf: true,
    canChangeRole: false,
    canRemove: true,
  },
];

describe("the screens behind a session", () => {
  it("is checked by something that can actually fail", async () => {
    // Without this, three green results would be indistinguishable from a
    // checker that ran no rules at all.
    const { container } = render(
      <main>
        <input type="text" />
      </main>,
    );

    expect(await violations(container)).not.toEqual([]);
  });

  it("a post with its photos, reactions and management panel", async () => {
    const { container } = render(
      <main>
        <PostCard
          actions={actions}
          basePath={basePath}
          entry={entry()}
          groupId={groupId}
          oshis={oshis}
        />
      </main>,
    );

    expect(await violations(container)).toEqual([]);
  });

  it("a post nobody has reacted to yet", async () => {
    const { container } = render(
      <main>
        <PostCard
          actions={actions}
          basePath={basePath}
          entry={entry({
            canEdit: false,
            canRemove: false,
            images: [],
            likeCount: 0,
            likedByViewer: false,
            replies: [],
            replyCount: 0,
            shares: [],
            shareCount: 0,
          })}
          groupId={groupId}
          oshis={oshis}
        />
      </main>,
    );

    expect(await violations(container)).toEqual([]);
  });

  it("the member roster with its role and removal controls", async () => {
    const { container } = render(
      <main>
        <MemberRoster
          groupId={groupId}
          members={roster}
          removeAction={noop}
          roleAction={noop}
        />
      </main>,
    );

    expect(await violations(container)).toEqual([]);
  });
});
