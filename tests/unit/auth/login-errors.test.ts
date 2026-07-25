import { describe, expect, it } from "vitest";

import { mapLoginError } from "@/lib/auth/login-errors";

describe("mapLoginError", () => {
  it("does not reveal whether the email or password was wrong", () => {
    const unknownEmail = mapLoginError({
      status: 400,
      code: "user_not_found",
      message: "No user exists for member@example.com",
    });
    const wrongPassword = mapLoginError({
      status: 400,
      code: "invalid_credentials",
      message: "Password was incorrect",
    });

    expect(unknownEmail).toEqual(wrongPassword);
    expect(unknownEmail).toMatchObject({
      kind: "invalid_credentials",
      status: 401,
    });
    expect(unknownEmail.message).not.toMatch(/member@example|user|password/i);
  });

  it("preserves a rate-limit response as HTTP 429 without leaking details", () => {
    const result = mapLoginError({
      status: 429,
      code: "over_request_rate_limit",
      message: "Internal limiter bucket auth-ip-123 was exhausted",
    });

    expect(result).toMatchObject({
      kind: "rate_limited",
      status: 429,
    });
    expect(result.message).not.toContain("auth-ip-123");
  });

  it("maps service and network failures to a generic unavailable response", () => {
    expect(mapLoginError({ status: 503, message: "upstream details" })).toEqual(
      {
        kind: "unavailable",
        status: 503,
        message:
          "ログイン処理を完了できませんでした。しばらく待ってからお試しください。",
      },
    );
    expect(mapLoginError(new TypeError("fetch failed")).kind).toBe(
      "unavailable",
    );
  });
});
