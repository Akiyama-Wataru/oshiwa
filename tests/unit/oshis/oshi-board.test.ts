import { describe, expect, it } from "vitest";

import {
  applySignedUrls,
  collectImagePaths,
  normalizeOshiRows,
} from "@/lib/oshis/oshi-board";

const groupId = "11111111-1111-4111-8111-111111111111";
const oshiId = "22222222-2222-4222-8222-222222222222";
const viewerId = "33333333-3333-4333-8333-333333333333";
const imagePath = `${groupId}/${oshiId}/${"a".repeat(32)}.webp`;

const viewer = { userId: viewerId, isManager: false };

describe("normalizeOshiRows", () => {
  it("keeps well formed rows and normalises the member colour", () => {
    const entries = normalizeOshiRows(
      [
        {
          id: oshiId,
          name: "ミナ",
          member_color: "#FF6F91",
          image_path: imagePath,
          created_by: viewerId,
        },
      ],
      viewer,
    );

    expect(entries).toEqual([
      {
        id: oshiId,
        name: "ミナ",
        color: "#ff6f91",
        imagePath,
        imageUrl: null,
        canManage: true,
      },
    ]);
  });

  it("drops rows that do not match the database shape", () => {
    expect(normalizeOshiRows(null, viewer)).toEqual([]);
    expect(normalizeOshiRows("nope", viewer)).toEqual([]);
    expect(
      normalizeOshiRows([null, 42, { id: 1, name: "x" }, { id: oshiId }], viewer),
    ).toEqual([]);
  });

  it("falls back to a neutral colour instead of rendering an unusable value", () => {
    const [entry] = normalizeOshiRows(
      [
        {
          id: oshiId,
          name: "ミナ",
          member_color: "url(javascript:alert(1))",
          created_by: viewerId,
        },
      ],
      viewer,
    );

    expect(entry.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(entry.color).not.toContain("javascript");
  });

  it("ignores an image path that is not group scoped", () => {
    const [entry] = normalizeOshiRows(
      [
        {
          id: oshiId,
          name: "ミナ",
          member_color: "#ff6f91",
          image_path: "../../secrets/passwd.webp",
          created_by: viewerId,
        },
      ],
      viewer,
    );

    expect(entry.imagePath).toBeNull();
  });

  it("grants management to the creator and to every group manager", () => {
    const rows = [
      {
        id: oshiId,
        name: "ミナ",
        member_color: "#ff6f91",
        created_by: "44444444-4444-4444-8444-444444444444",
      },
    ];

    expect(normalizeOshiRows(rows, viewer)[0].canManage).toBe(false);
    expect(
      normalizeOshiRows(rows, { userId: viewerId, isManager: true })[0]
        .canManage,
    ).toBe(true);
  });
});

describe("collectImagePaths and applySignedUrls", () => {
  const entries = normalizeOshiRows(
    [
      {
        id: oshiId,
        name: "ミナ",
        member_color: "#ff6f91",
        image_path: imagePath,
        created_by: viewerId,
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        name: "サナ",
        member_color: "#59a5f5",
        created_by: viewerId,
      },
    ],
    viewer,
  );

  it("asks only for the paths that exist", () => {
    expect(collectImagePaths(entries)).toEqual([imagePath]);
  });

  it("attaches a signed url without mutating the original entries", () => {
    const signed = applySignedUrls(entries, [
      { path: imagePath, signedUrl: "https://storage.test/signed" },
    ]);

    expect(signed[0].imageUrl).toBe("https://storage.test/signed");
    expect(signed[1].imageUrl).toBeNull();
    expect(entries[0].imageUrl).toBeNull();
  });

  it("leaves the url empty when signing failed or is missing", () => {
    expect(
      applySignedUrls(entries, [
        { path: imagePath, signedUrl: "https://storage.test/x", error: "denied" },
      ])[0].imageUrl,
    ).toBeNull();
    expect(applySignedUrls(entries, null)[0].imageUrl).toBeNull();
    expect(applySignedUrls(entries, [{ path: imagePath }])[0].imageUrl).toBeNull();
  });
});
