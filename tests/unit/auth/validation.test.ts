import { describe, expect, it } from "vitest";

import {
  inviteTokenSchema,
  loginSchema,
  setPasswordSchema,
} from "@/lib/validation/auth";

describe("authentication input validation", () => {
  it("normalizes login email without mutating the password", () => {
    const result = loginSchema.parse({
      email: "  MEMBER+Oshi@Example.COM ",
      password: " 12-character password ",
    });

    expect(result).toEqual({
      email: "member+oshi@example.com",
      password: " 12-character password ",
    });
  });

  it("requires a valid email and at least 12 password characters", () => {
    expect(
      loginSchema.safeParse({
        email: "not-an-email",
        password: "12345678901",
      }).success,
    ).toBe(false);
    expect(
      loginSchema.safeParse({
        email: "member@example.com",
        password: "123456789012",
      }).success,
    ).toBe(true);
  });

  it("applies the same password boundary when setting a password", () => {
    expect(
      setPasswordSchema.safeParse({ password: "12345678901" }).success,
    ).toBe(false);
    expect(
      setPasswordSchema.safeParse({ password: "123456789012" }).success,
    ).toBe(true);
  });

  it("accepts URL-safe invite and confirmation tokens only", () => {
    const token =
      "5a6b7c8d9e0f1234567890abcdef1234567890abcdef1234567890abcdef1234";

    expect(inviteTokenSchema.parse(` ${token.toUpperCase()} `)).toBe(token);
    expect(inviteTokenSchema.safeParse("short").success).toBe(false);
    expect(inviteTokenSchema.safeParse(`${token}/path`).success).toBe(false);
    expect(inviteTokenSchema.safeParse(null).success).toBe(false);
  });
});
