import { describe, expect, it } from "vitest";

import {
  normalizeReplies,
  normalizeShares,
  readReactionCount,
  readReactionFlag,
} from "@/lib/posts/reactions";

const replyId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const otherReplyId = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const shareId = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const memberId = "4d2f6b18-2a70-4a1f-91b1-9d3a2c5e7f01";
const viewerId = "5e3a7c29-3b81-4b2f-82c2-8e4b3d6f8a12";

function replyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: replyId,
    body: "わたしも行きたかった",
    created_at: "2026-07-28T10:00:00+00:00",
    author_id: memberId,
    author_name: "みお",
    ...overrides,
  };
}

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: shareId,
    note: "これ見て",
    created_at: "2026-07-28T11:00:00+00:00",
    sharer_id: memberId,
    sharer_name: "みお",
    ...overrides,
  };
}

const plainViewer = { userId: viewerId, isManager: false };

describe("normalizeReplies", () => {
  it("shapes a row into a reply the card can render", () => {
    expect(normalizeReplies([replyRow()], plainViewer)).toEqual([
      {
        id: replyId,
        body: "わたしも行きたかった",
        createdAt: "2026-07-28T10:00:00+00:00",
        authorId: memberId,
        authorName: "みお",
        canRemove: false,
      },
    ]);
  });

  it("offers removal to the member who wrote it and to a manager", () => {
    const [own] = normalizeReplies([replyRow({ author_id: viewerId })], plainViewer);
    const [moderated] = normalizeReplies([replyRow()], {
      userId: viewerId,
      isManager: true,
    });

    expect(own.canRemove).toBe(true);
    expect(moderated.canRemove).toBe(true);
  });

  it("names an unreadable profile rather than leaving the reply unsigned", () => {
    const [entry] = normalizeReplies([replyRow({ author_name: null })], plainViewer);

    expect(entry.authorName).toBe("メンバー");
  });

  it("drops rows the database could not have produced", () => {
    expect(
      normalizeReplies(
        [
          replyRow({ id: "not-a-uuid" }),
          replyRow({ id: otherReplyId, author_id: "not-a-uuid" }),
          replyRow({ id: otherReplyId, body: 42 }),
          replyRow({ id: otherReplyId, created_at: "whenever" }),
          null,
          "reply",
        ],
        plainViewer,
      ),
    ).toEqual([]);
    expect(normalizeReplies(null, plainViewer)).toEqual([]);
  });
});

describe("normalizeShares", () => {
  it("shapes a row into a share the card can render", () => {
    expect(normalizeShares([shareRow()], plainViewer)).toEqual([
      {
        id: shareId,
        note: "これ見て",
        createdAt: "2026-07-28T11:00:00+00:00",
        sharerId: memberId,
        sharerName: "みお",
        isViewer: false,
      },
    ]);
  });

  it("marks the reader's own share so it can be withdrawn", () => {
    const [entry] = normalizeShares(
      [shareRow({ sharer_id: viewerId })],
      plainViewer,
    );

    expect(entry.isViewer).toBe(true);
  });

  it("treats a share without a note as a share, not as a broken row", () => {
    const [entry] = normalizeShares([shareRow({ note: null })], plainViewer);

    expect(entry.note).toBeNull();
  });

  it("drops a note it cannot render", () => {
    const [entry] = normalizeShares(
      [shareRow({ note: `zero${String.fromCharCode(8203)}width` })],
      plainViewer,
    );

    expect(entry.note).toBeNull();
  });

  it("drops rows the database could not have produced", () => {
    expect(
      normalizeShares(
        [shareRow({ sharer_id: "not-a-uuid" }), shareRow({ id: 7 }), null],
        plainViewer,
      ),
    ).toEqual([]);
    expect(normalizeShares(undefined, plainViewer)).toEqual([]);
  });
});

describe("readReactionCount", () => {
  it("accepts the number and the numeric string a bigint can arrive as", () => {
    expect(readReactionCount(3)).toBe(3);
    expect(readReactionCount("12")).toBe(12);
  });

  it("reads anything else as none rather than as NaN", () => {
    for (const value of [null, undefined, "many", -1, 1.5, {}]) {
      expect(readReactionCount(value)).toBe(0);
    }
  });
});

describe("readReactionFlag", () => {
  it("only trusts a real boolean", () => {
    expect(readReactionFlag(true)).toBe(true);
    expect(readReactionFlag(false)).toBe(false);
    expect(readReactionFlag("true")).toBe(false);
    expect(readReactionFlag(1)).toBe(false);
    expect(readReactionFlag(null)).toBe(false);
  });
});
