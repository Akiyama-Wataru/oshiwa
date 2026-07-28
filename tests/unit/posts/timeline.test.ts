import { describe, expect, it } from "vitest";

import {
  applyTimelineSignedUrls,
  collectTimelineImagePaths,
  decodeTimelineCursor,
  encodeTimelineCursor,
  normalizeTimelineRows,
  nextTimelineCursor,
} from "@/lib/posts/timeline";

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const postId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const otherPostId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const authorId = "4d2f6b18-2a70-4a1f-91b1-9d3a2c5e7f01";
const readerId = "5e3a7c29-3b81-4b2f-82c2-8e4b3d6f8a12";
const oshiId = "6f4b8d3a-4c92-4c3f-93d3-7f5c4e7a9b23";

function imagePath(suffix: string): string {
  return `${groupId}/${postId}/${suffix.repeat(32)}.webp`;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: postId,
    body: "一曲目がよかった",
    created_at: "2026-07-27T11:00:00+00:00",
    updated_at: "2026-07-27T11:00:00+00:00",
    author_id: authorId,
    author_name: "みお",
    images: [
      { image_path: imagePath("b"), sort_order: 2 },
      { image_path: imagePath("a"), sort_order: 1 },
    ],
    oshis: [{ id: oshiId, name: "ミナ", member_color: "#FF6F91" }],
    hashtags: ["今日の推し", "尊い"],
    ...overrides,
  };
}

const viewer = { userId: authorId, isManager: false };

describe("normalizeTimelineRows", () => {
  it("shapes a row into an entry the timeline can render", () => {
    const [entry] = normalizeTimelineRows([row()], viewer);

    expect(entry).toMatchObject({
      id: postId,
      body: "一曲目がよかった",
      authorName: "みお",
      hashtags: ["今日の推し", "尊い"],
      edited: false,
    });
    expect(entry.oshis).toEqual([
      { id: oshiId, name: "ミナ", color: "#ff6f91" },
    ]);
  });

  it("orders the images by their stored slot rather than their arrival", () => {
    const [entry] = normalizeTimelineRows([row()], viewer);

    expect(entry.images.map((image) => image.imagePath)).toEqual([
      imagePath("a"),
      imagePath("b"),
    ]);
    expect(entry.images.every((image) => image.imageUrl === null)).toBe(true);
  });

  it("drops values the database could not have produced", () => {
    const [entry] = normalizeTimelineRows(
      [
        row({
          images: [
            { image_path: "../../etc/passwd", sort_order: 1 },
            { image_path: imagePath("a"), sort_order: 2 },
          ],
          oshis: [
            { id: oshiId, name: "ミナ", member_color: "not-a-colour" },
            { id: "not-a-uuid", name: "サナ", member_color: "#59a5f5" },
          ],
          hashtags: ["尊い", 42, "壊‮れた"],
        }),
      ],
      viewer,
    );

    expect(entry.images).toHaveLength(1);
    expect(entry.oshis).toHaveLength(1);
    expect(entry.oshis[0].color).toBe("#8d99ae");
    expect(entry.hashtags).toEqual(["尊い"]);
  });

  it("skips rows without the identity the actions need", () => {
    expect(
      normalizeTimelineRows(
        [row({ id: "not-a-uuid" }), row({ body: 7 }), null, "post"],
        viewer,
      ),
    ).toEqual([]);
    expect(normalizeTimelineRows(null, viewer)).toEqual([]);
  });

  it("names a byline the reader cannot resolve without inventing one", () => {
    const [entry] = normalizeTimelineRows([row({ author_name: null })], viewer);

    expect(entry.authorName).toBe("メンバー");
  });

  it("marks a post as edited only once it differs from its creation", () => {
    const [entry] = normalizeTimelineRows(
      [row({ updated_at: "2026-07-27T12:30:00+00:00" })],
      viewer,
    );

    expect(entry.edited).toBe(true);
  });

  it("lets only the author rewrite, and a manager also remove", () => {
    const [own] = normalizeTimelineRows([row()], viewer);
    const [asMember] = normalizeTimelineRows([row()], {
      userId: readerId,
      isManager: false,
    });
    const [asManager] = normalizeTimelineRows([row()], {
      userId: readerId,
      isManager: true,
    });

    expect(own).toMatchObject({ canEdit: true, canRemove: true });
    expect(asMember).toMatchObject({ canEdit: false, canRemove: false });
    expect(asManager).toMatchObject({ canEdit: false, canRemove: true });
  });
});

describe("collectTimelineImagePaths", () => {
  it("gathers every path across the page exactly once", () => {
    const entries = normalizeTimelineRows(
      [row(), row({ id: otherPostId, images: [] })],
      viewer,
    );

    expect(collectTimelineImagePaths(entries)).toEqual([
      imagePath("a"),
      imagePath("b"),
    ]);
  });
});

describe("applyTimelineSignedUrls", () => {
  it("attaches the url that belongs to each path", () => {
    const entries = normalizeTimelineRows([row()], viewer);

    const signed = applyTimelineSignedUrls(entries, [
      { path: imagePath("a"), signedUrl: "https://example.test/a" },
      { path: imagePath("b"), signedUrl: "https://example.test/b" },
    ]);

    expect(signed[0].images.map((image) => image.imageUrl)).toEqual([
      "https://example.test/a",
      "https://example.test/b",
    ]);
  });

  it("leaves an unsigned or failed object without a url", () => {
    const entries = normalizeTimelineRows([row()], viewer);

    const signed = applyTimelineSignedUrls(entries, [
      {
        path: imagePath("a"),
        signedUrl: "https://example.test/a",
        error: "expired",
      },
    ]);

    expect(signed[0].images.map((image) => image.imageUrl)).toEqual([
      null,
      null,
    ]);
    expect(applyTimelineSignedUrls(entries, null)[0].images[0].imageUrl).toBe(
      null,
    );
  });
});

describe("timeline cursors", () => {
  it("round trips the pair the keyset needs", () => {
    const cursor = encodeTimelineCursor({
      createdAt: "2026-07-27T11:00:00+00:00",
      id: postId,
    });

    expect(decodeTimelineCursor(cursor)).toEqual({
      createdAt: "2026-07-27T11:00:00+00:00",
      id: postId,
    });
  });

  it("refuses anything that is not a timestamp and an id", () => {
    for (const candidate of [
      "",
      "2026-07-27T11:00:00+00:00",
      postId,
      `yesterday_${postId}`,
      "2026-07-27T11:00:00+00:00_not-a-uuid",
      `2026-07-27T11:00:00+00:00_${postId}_extra`,
      null,
      42,
    ]) {
      expect(decodeTimelineCursor(candidate)).toBe(null);
    }
  });

  it("points at the last entry of a full page and nowhere on a short one", () => {
    const entries = normalizeTimelineRows(
      [row(), row({ id: otherPostId, created_at: "2026-07-27T10:00:00+00:00" })],
      viewer,
    );

    expect(nextTimelineCursor(entries, 2)).toBe(
      `2026-07-27T10:00:00+00:00_${otherPostId}`,
    );
    expect(nextTimelineCursor(entries, 20)).toBe(null);
    expect(nextTimelineCursor([], 20)).toBe(null);
  });
});
