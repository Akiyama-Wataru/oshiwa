import { describe, expect, it } from "vitest";

import {
  createGroupSchema,
  createInvitationSchema,
  siteUrlSchema,
  siteUrlSchemaForMode,
} from "@/lib/validation/groups";

describe("group and invitation validation", () => {
  it("trims group names and enforces the database length boundary", () => {
    expect(createGroupSchema.parse({ name: "  いつもの輪  " })).toEqual({
      name: "いつもの輪",
    });
    expect(createGroupSchema.safeParse({ name: " " }).success).toBe(false);
    expect(
      createGroupSchema.safeParse({ name: "推".repeat(101) }).success,
    ).toBe(false);
  });

  it("normalizes invitation email and only accepts manager-grantable roles", () => {
    const valid = {
      groupId: "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd",
      email: "  FAN@EXAMPLE.COM ",
      role: "admin",
    };

    expect(createInvitationSchema.parse(valid)).toEqual({
      ...valid,
      email: "fan@example.com",
    });
    expect(
      createInvitationSchema.safeParse({ ...valid, role: "owner" }).success,
    ).toBe(false);
    expect(
      createInvitationSchema.safeParse({ ...valid, groupId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("accepts only a credential-free HTTP(S) site origin", () => {
    expect(siteUrlSchema.parse("https://oshiwa.test/")).toBe(
      "https://oshiwa.test",
    );
    expect(siteUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(
      siteUrlSchema.safeParse("https://user:pass@oshiwa.test").success,
    ).toBe(false);
    expect(
      siteUrlSchema.safeParse("https://oshiwa.test/unexpected").success,
    ).toBe(false);
  });

  it("requires HTTPS in production but permits HTTP in test/development", () => {
    expect(
      siteUrlSchemaForMode("production").safeParse("http://oshiwa.test")
        .success,
    ).toBe(false);
    expect(
      siteUrlSchemaForMode("production").parse("https://oshiwa.test"),
    ).toBe("https://oshiwa.test");
    expect(
      siteUrlSchemaForMode("development").parse("http://localhost:3000"),
    ).toBe("http://localhost:3000");
    expect(siteUrlSchemaForMode("test").parse("http://oshiwa.test")).toBe(
      "http://oshiwa.test",
    );
  });
});
