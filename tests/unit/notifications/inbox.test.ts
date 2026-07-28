import { describe, expect, it } from "vitest";

import {
  describeNotification,
  normalizeNotificationRows,
} from "@/lib/notifications/inbox";

const notificationId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const otherId = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const postId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const replyId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const actorId = "4d2f6b18-2a70-4a1f-91b1-9d3a2c5e7f01";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: notificationId,
    kind: "like",
    created_at: "2026-07-28T10:00:00+00:00",
    read_at: null,
    group_id: groupId,
    group_name: "推し会",
    post_id: postId,
    post_excerpt: "今日のライブ最高だった",
    reply_id: null,
    reply_body: null,
    actor_id: actorId,
    actor_name: "みお",
    ...overrides,
  };
}

describe("normalizeNotificationRows", () => {
  it("shapes a row into something the list can render and link to", () => {
    expect(normalizeNotificationRows([row()])).toEqual([
      {
        id: notificationId,
        kind: "like",
        createdAt: "2026-07-28T10:00:00+00:00",
        unread: true,
        groupId,
        groupName: "推し会",
        postId,
        postExcerpt: "今日のライブ最高だった",
        replyBody: null,
        actorName: "みお",
        href: `/groups/${groupId}/posts/${postId}`,
      },
    ]);
  });

  it("marks a notification that has been read", () => {
    const [entry] = normalizeNotificationRows([
      row({ read_at: "2026-07-28T11:00:00+00:00" }),
    ]);

    expect(entry.unread).toBe(false);
  });

  it("carries the reply so a member can see what was said", () => {
    const [entry] = normalizeNotificationRows([
      row({
        kind: "reply",
        reply_id: replyId,
        reply_body: "わたしも行きたかった",
      }),
    ]);

    expect(entry).toMatchObject({
      kind: "reply",
      replyBody: "わたしも行きたかった",
    });
  });

  it("drops rows it cannot turn into a link", () => {
    expect(
      normalizeNotificationRows([
        row({ id: "not-a-uuid" }),
        row({ id: otherId, post_id: "not-a-uuid" }),
        row({ id: otherId, group_id: null }),
        row({ id: otherId, kind: "poke" }),
        row({ id: otherId, created_at: "whenever" }),
        null,
        "notification",
      ]),
    ).toEqual([]);
    expect(normalizeNotificationRows(null)).toEqual([]);
  });

  it("names a circle or a member it cannot resolve without inventing one", () => {
    const [entry] = normalizeNotificationRows([
      row({ group_name: null, actor_name: "" }),
    ]);

    expect(entry.groupName).toBe("参加中の輪");
    expect(entry.actorName).toBe("メンバー");
  });

  it("survives a post whose body it could not read", () => {
    const [entry] = normalizeNotificationRows([row({ post_excerpt: null })]);

    expect(entry.postExcerpt).toBe("");
  });
});

describe("describeNotification", () => {
  it("says what happened in the reader's own terms", () => {
    const [liked] = normalizeNotificationRows([row()]);
    const [replied] = normalizeNotificationRows([
      row({ kind: "reply", reply_id: replyId, reply_body: "いいね" }),
    ]);
    const [shared] = normalizeNotificationRows([row({ kind: "share" })]);

    expect(describeNotification(liked)).toBe("みおがいいねしました");
    expect(describeNotification(replied)).toBe("みおが返信しました");
    expect(describeNotification(shared)).toBe("みおが輪に共有しました");
  });
});
