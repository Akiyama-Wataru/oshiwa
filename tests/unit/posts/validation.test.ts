import { describe, expect, it } from "vitest";

import {
  MAX_POST_HASHTAGS,
  MAX_POST_IMAGES,
  MAX_POST_OSHIS,
  POST_BODY_MAX_LENGTH,
  buildPostImagePath,
  createPostSchema,
  deletePostSchema,
  postImagePathSchema,
  splitHashtagInput,
  updatePostSchema,
} from "@/lib/validation/posts";

const groupId = "11111111-1111-4111-8111-111111111111";
const postId = "22222222-2222-4222-8222-222222222222";
const oshiId = "33333333-3333-4333-8333-333333333333";
const otherOshiId = "44444444-4444-4444-8444-444444444444";

function post(overrides: Record<string, unknown> = {}) {
  return {
    groupId,
    body: "今日のライブ最高だった",
    oshiIds: [oshiId],
    hashtags: ["今日の推し"],
    ...overrides,
  };
}

describe("createPostSchema", () => {
  it("trims the body and normalises the tags", () => {
    const parsed = createPostSchema.parse(
      post({ body: "  最高だった  ", hashtags: ["#今日の推し", " 尊い "] }),
    );

    expect(parsed.body).toBe("最高だった");
    expect(parsed.hashtags).toEqual(["今日の推し", "尊い"]);
    expect(parsed.oshiIds).toEqual([oshiId]);
  });

  it("keeps the line breaks a written post needs", () => {
    const parsed = createPostSchema.parse(
      post({ body: "一曲目から\n泣いてしまった" }),
    );

    expect(parsed.body).toBe("一曲目から\n泣いてしまった");
  });

  it("rejects an empty or overlong body", () => {
    expect(createPostSchema.safeParse(post({ body: "   " })).success).toBe(
      false,
    );
    expect(
      createPostSchema.safeParse(post({ body: "あ".repeat(POST_BODY_MAX_LENGTH) }))
        .success,
    ).toBe(true);
    expect(
      createPostSchema.safeParse({
        ...post(),
        body: "あ".repeat(POST_BODY_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects a body carrying invisible or bidirectional overrides", () => {
    const nul = String.fromCharCode(0);
    const rightToLeftOverride = String.fromCharCode(0x202e);
    const zeroWidthSpace = String.fromCharCode(0x200b);

    for (const body of [
      `最高${nul}`,
      `最高${rightToLeftOverride}だった`,
      `最高${zeroWidthSpace}だった`,
    ]) {
      expect(createPostSchema.safeParse(post({ body })).success).toBe(false);
    }
  });

  it("accepts a post with no oshi and no tag", () => {
    const parsed = createPostSchema.parse(
      post({ oshiIds: [], hashtags: [] }),
    );

    expect(parsed.oshiIds).toEqual([]);
    expect(parsed.hashtags).toEqual([]);
  });

  it("rejects duplicated or oversized associations", () => {
    expect(
      createPostSchema.safeParse(post({ oshiIds: [oshiId, oshiId] })).success,
    ).toBe(false);
    expect(
      createPostSchema.safeParse(post({ hashtags: ["尊い", "尊い"] })).success,
    ).toBe(false);
    expect(
      createPostSchema.safeParse(
        post({
          oshiIds: Array.from(
            { length: MAX_POST_OSHIS + 1 },
            (_value, index) =>
              `55555555-5555-4555-8555-${index.toString().padStart(12, "0")}`,
          ),
        }),
      ).success,
    ).toBe(false);
    expect(
      createPostSchema.safeParse(
        post({
          hashtags: Array.from(
            { length: MAX_POST_HASHTAGS + 1 },
            (_value, index) => `tag${index}`,
          ),
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects a tag that is empty, spaced, or nested", () => {
    for (const tag of ["", "#", "今日 の推し", "推し#活", "あ".repeat(31)]) {
      expect(createPostSchema.safeParse(post({ hashtags: [tag] })).success).toBe(
        false,
      );
    }
  });

  it("treats tags differing only by case as the same tag", () => {
    expect(
      createPostSchema.safeParse(post({ hashtags: ["Live", "live"] })).success,
    ).toBe(false);
  });

  it("rejects a group id that is not a uuid", () => {
    expect(createPostSchema.safeParse(post({ groupId: "friends" })).success).toBe(
      false,
    );
  });
});

describe("updatePostSchema and deletePostSchema", () => {
  it("targets a post by uuid", () => {
    expect(
      updatePostSchema.parse({
        postId,
        body: " 更新した ",
        oshiIds: [otherOshiId],
        hashtags: ["再放送"],
      }),
    ).toEqual({
      postId,
      body: "更新した",
      oshiIds: [otherOshiId],
      hashtags: ["再放送"],
    });

    expect(deletePostSchema.parse({ postId })).toEqual({ postId });
    expect(deletePostSchema.safeParse({ postId: "nope" }).success).toBe(false);
  });
});

describe("post image paths", () => {
  it("builds a group and post scoped opaque path", () => {
    const path = buildPostImagePath({
      groupId,
      postId,
      extension: "webp",
      randomId: "b".repeat(32),
    });

    expect(path).toBe(`${groupId}/${postId}/${"b".repeat(32)}.webp`);
    expect(postImagePathSchema.parse(path)).toBe(path);
  });

  it("lowercases identifiers so the stored path stays matchable", () => {
    expect(
      buildPostImagePath({
        groupId: groupId.toUpperCase(),
        postId: postId.toUpperCase(),
        extension: "jpg",
        randomId: "c".repeat(32),
      }),
    ).toBe(`${groupId}/${postId}/${"c".repeat(32)}.jpg`);
  });

  it("refuses traversal, absolute, and scriptable paths", () => {
    for (const path of [
      `${groupId}/${postId}/../../secret.webp`,
      `/${groupId}/${postId}/${"b".repeat(32)}.webp`,
      `${groupId}/${postId}/${"b".repeat(32)}.svg`,
      `${groupId}/${"b".repeat(32)}.webp`,
      `${groupId}/${postId}/${"B".repeat(32)}.webp`,
    ]) {
      expect(postImagePathSchema.safeParse(path).success).toBe(false);
    }

    expect(() =>
      buildPostImagePath({
        groupId: "../../other",
        postId,
        extension: "webp",
        randomId: "b".repeat(32),
      }),
    ).toThrow();
  });

  it("caps a post at four images", () => {
    expect(MAX_POST_IMAGES).toBe(4);
  });
});

describe("splitHashtagInput", () => {
  it("reads one written line as the separate tags a reader sees", () => {
    expect(splitHashtagInput("#今日の推し #尊い")).toEqual([
      "#今日の推し",
      "#尊い",
    ]);
  });

  it("accepts the separators a Japanese keyboard produces", () => {
    expect(splitHashtagInput("ライブ、尊い，最高　神席\n現場")).toEqual([
      "ライブ",
      "尊い",
      "最高",
      "神席",
      "現場",
    ]);
  });

  it("returns nothing for blank or non-text input", () => {
    for (const candidate of ["", "   ", null, undefined, 7]) {
      expect(splitHashtagInput(candidate)).toEqual([]);
    }
  });

  it("hands the split tags to the schema that trims the hash", () => {
    const parsed = createPostSchema.safeParse(
      post({ hashtags: splitHashtagInput(" #ライブ  #尊い ") }),
    );

    expect(parsed.success && parsed.data.hashtags).toEqual(["ライブ", "尊い"]);
  });
});
