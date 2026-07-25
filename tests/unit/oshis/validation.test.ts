import { describe, expect, it } from "vitest";

import {
  MAX_OSHIS_PER_GROUP,
  OSHI_NAME_MAX_LENGTH,
  buildOshiImagePath,
  createOshiSchema,
  deleteOshiSchema,
  oshiImagePathSchema,
  reorderOshisSchema,
  updateOshiSchema,
} from "@/lib/validation/oshis";

const groupId = "11111111-1111-4111-8111-111111111111";
const oshiId = "22222222-2222-4222-8222-222222222222";
const otherOshiId = "33333333-3333-4333-8333-333333333333";

describe("createOshiSchema", () => {
  it("trims the name and normalises the member colour", () => {
    const parsed = createOshiSchema.parse({
      groupId,
      name: "  推しちゃん  ",
      color: "#FF6F91",
    });

    expect(parsed).toEqual({
      groupId,
      name: "推しちゃん",
      color: "#ff6f91",
    });
  });

  it("rejects an empty or overlong name", () => {
    expect(
      createOshiSchema.safeParse({ groupId, name: "   ", color: "#ff6f91" })
        .success,
    ).toBe(false);
    expect(
      createOshiSchema.safeParse({
        groupId,
        name: "あ".repeat(OSHI_NAME_MAX_LENGTH + 1),
        color: "#ff6f91",
      }).success,
    ).toBe(false);
    expect(
      createOshiSchema.safeParse({
        groupId,
        name: "あ".repeat(OSHI_NAME_MAX_LENGTH),
        color: "#ff6f91",
      }).success,
    ).toBe(true);
  });

  it("rejects names carrying control characters or line breaks", () => {
    const nul = String.fromCharCode(0);
    const escape = String.fromCharCode(27);

    for (const name of [
      `推し${nul}`,
      "推し\nちゃん",
      "推し\tちゃん",
      `推し${escape}[31m`,
    ]) {
      expect(
        createOshiSchema.safeParse({ groupId, name, color: "#ff6f91" }).success,
      ).toBe(false);
    }
  });

  it("accepts only the presets the stylesheet knows how to paint", () => {
    for (const color of [
      "red",
      "rgb(255,0,0)",
      "#ff00",
      "var(--x)",
      "#ff0000;background:url(javascript:alert(1))",
      // A valid hex that is not a preset has no class in globals.css, so it
      // would render as an unstyled chip.
      "#abcdef",
    ]) {
      expect(
        createOshiSchema.safeParse({ groupId, name: "推し", color }).success,
      ).toBe(false);
    }
  });

  it("rejects a group id that is not a uuid", () => {
    expect(
      createOshiSchema.safeParse({
        groupId: "friends",
        name: "推し",
        color: "#ff6f91",
      }).success,
    ).toBe(false);
  });
});

describe("updateOshiSchema and deleteOshiSchema", () => {
  it("requires a uuid target", () => {
    expect(
      updateOshiSchema.parse({ oshiId, name: " 推し ", color: "#1D3557" }),
    ).toEqual({ oshiId, name: "推し", color: "#1d3557" });

    expect(
      updateOshiSchema.safeParse({
        oshiId: "not-a-uuid",
        name: "推し",
        color: "#1d3557",
      }).success,
    ).toBe(false);

    expect(deleteOshiSchema.parse({ oshiId })).toEqual({ oshiId });
    expect(deleteOshiSchema.safeParse({ oshiId: "" }).success).toBe(false);
  });
});

describe("reorderOshisSchema", () => {
  it("accepts a unique, non-empty list of group scoped ids", () => {
    expect(
      reorderOshisSchema.parse({ groupId, orderedIds: [oshiId, otherOshiId] }),
    ).toEqual({ groupId, orderedIds: [oshiId, otherOshiId] });
  });

  it("rejects empty, duplicated, oversized, or malformed lists", () => {
    expect(
      reorderOshisSchema.safeParse({ groupId, orderedIds: [] }).success,
    ).toBe(false);
    expect(
      reorderOshisSchema.safeParse({ groupId, orderedIds: [oshiId, oshiId] })
        .success,
    ).toBe(false);
    expect(
      reorderOshisSchema.safeParse({ groupId, orderedIds: [oshiId, "x"] })
        .success,
    ).toBe(false);
    expect(
      reorderOshisSchema.safeParse({
        groupId,
        orderedIds: Array.from(
          { length: MAX_OSHIS_PER_GROUP + 1 },
          (_value, index) =>
            `44444444-4444-4444-8444-${index.toString().padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });
});

describe("oshi image paths", () => {
  it("builds a group scoped, opaque object path", () => {
    const path = buildOshiImagePath({
      groupId,
      oshiId,
      extension: "webp",
      randomId: "a".repeat(32),
    });

    expect(path).toBe(`${groupId}/${oshiId}/${"a".repeat(32)}.webp`);
    expect(oshiImagePathSchema.parse(path)).toBe(path);
  });

  it("refuses to build a path from an untrusted identifier", () => {
    expect(() =>
      buildOshiImagePath({
        groupId: "../../other",
        oshiId,
        extension: "webp",
        randomId: "a".repeat(32),
      }),
    ).toThrow();

    expect(() =>
      buildOshiImagePath({
        groupId,
        oshiId,
        extension: "webp",
        randomId: "../secret",
      }),
    ).toThrow();
  });

  it("rejects traversal, absolute, and mismatched extension paths", () => {
    for (const path of [
      `${groupId}/${oshiId}/../../secret.webp`,
      `/${groupId}/${oshiId}/${"a".repeat(32)}.webp`,
      `${groupId}/${oshiId}/${"a".repeat(32)}.svg`,
      `${groupId}/${oshiId}/${"a".repeat(32)}.webp.svg`,
      `${groupId}/${"a".repeat(32)}.webp`,
      `${groupId}/${oshiId}/${"a".repeat(31)}.webp`,
      `${groupId}/${oshiId}/${"A".repeat(32)}.webp`,
    ]) {
      expect(oshiImagePathSchema.safeParse(path).success).toBe(false);
    }
  });

  it("keeps the per-group cap small enough for a single page render", () => {
    expect(MAX_OSHIS_PER_GROUP).toBeLessThanOrEqual(50);
  });
});

describe("uuid canonicalisation", () => {
  it("lowercases identifiers so object paths stay matchable", () => {
    const upper = groupId.toUpperCase();

    expect(
      createOshiSchema.parse({
        groupId: upper,
        name: "推し",
        color: "#ff6f91",
      }).groupId,
    ).toBe(groupId);

    expect(
      buildOshiImagePath({
        groupId: upper,
        oshiId: oshiId.toUpperCase(),
        extension: "webp",
        randomId: "a".repeat(32),
      }),
    ).toBe(`${groupId}/${oshiId}/${"a".repeat(32)}.webp`);
  });
});
