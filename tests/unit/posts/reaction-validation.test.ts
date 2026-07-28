import { describe, expect, it } from "vitest";

import {
  REPLY_BODY_MAX_LENGTH,
  SHARE_NOTE_MAX_LENGTH,
  createReplySchema,
  deleteReplySchema,
  replyBodySchema,
  shareNoteSchema,
  sharePostSchema,
  togglePostLikeSchema,
} from "@/lib/validation/reactions";

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const postId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const replyId = "9f4e2c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b";

describe("replyBodySchema", () => {
  it("keeps what was written and drops the surrounding whitespace", () => {
    expect(replyBodySchema.parse("  わたしも行きたかった  ")).toBe(
      "わたしも行きたかった",
    );
  });

  it("keeps the line breaks a member typed, normalised", () => {
    expect(replyBodySchema.parse("一行目\r\n二行目")).toBe("一行目\n二行目");
  });

  it("refuses a reply that says nothing", () => {
    for (const value of ["", "   ", "\n\n"]) {
      expect(replyBodySchema.safeParse(value).success).toBe(false);
    }
  });

  it("refuses a reply longer than the database will store", () => {
    expect(
      replyBodySchema.safeParse("あ".repeat(REPLY_BODY_MAX_LENGTH)).success,
    ).toBe(true);
    expect(
      replyBodySchema.safeParse("あ".repeat(REPLY_BODY_MAX_LENGTH + 1)).success,
    ).toBe(false);
  });

  it("refuses characters that would not survive being displayed", () => {
    expect(
      replyBodySchema.safeParse(`zero${String.fromCharCode(8203)}width`).success,
    ).toBe(false);
  });
});

describe("shareNoteSchema", () => {
  it("treats an empty note as no note at all", () => {
    for (const value of ["", "   ", null, undefined]) {
      expect(shareNoteSchema.parse(value)).toBeNull();
    }
  });

  it("keeps a note the reader will see, trimmed", () => {
    expect(shareNoteSchema.parse("  これ見て  ")).toBe("これ見て");
  });

  it("refuses a note longer than the database will store", () => {
    expect(
      shareNoteSchema.safeParse("あ".repeat(SHARE_NOTE_MAX_LENGTH)).success,
    ).toBe(true);
    expect(
      shareNoteSchema.safeParse("あ".repeat(SHARE_NOTE_MAX_LENGTH + 1)).success,
    ).toBe(false);
  });
});

describe("reaction form schemas", () => {
  it("requires a circle and a post before a like is sent anywhere", () => {
    expect(togglePostLikeSchema.safeParse({ groupId, postId }).success).toBe(
      true,
    );
    expect(
      togglePostLikeSchema.safeParse({ groupId, postId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(togglePostLikeSchema.safeParse({ postId }).success).toBe(false);
  });

  it("carries the note alongside the post being shared", () => {
    expect(
      sharePostSchema.parse({ groupId, postId, note: " これ見て " }),
    ).toEqual({ groupId, postId, note: "これ見て" });
  });

  it("accepts a reply and a removal addressed by their own identifiers", () => {
    expect(
      createReplySchema.parse({ groupId, postId, body: " ありがとう " }),
    ).toEqual({ groupId, postId, body: "ありがとう" });
    expect(deleteReplySchema.safeParse({ groupId, replyId }).success).toBe(true);
    expect(
      deleteReplySchema.safeParse({ groupId, replyId: postId + "0" }).success,
    ).toBe(false);
  });
});
