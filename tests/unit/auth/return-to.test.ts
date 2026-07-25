import { describe, expect, it } from "vitest";

import { safeReturnTo } from "@/lib/auth/return-to";
import { safeReturnTo as safeReturnToFromRedirect } from "@/lib/auth/redirect";

describe("safeReturnTo", () => {
  it("is available from the stable redirect module", () => {
    expect(safeReturnToFromRedirect("/groups/friends")).toBe(
      "/groups/friends",
    );
  });

  it("preserves a same-origin relative path, query, and fragment", () => {
    expect(safeReturnTo("/groups/friends?tab=members#top")).toBe(
      "/groups/friends?tab=members#top",
    );
  });

  it("allows an exact lowercase 64-hex invitation continuation", () => {
    const token = "a".repeat(64);

    expect(safeReturnTo(`/join/${token}?source=login#continue`)).toBe(
      `/join/${token}?source=login#continue`,
    );
  });

  it.each([
    `/join/${"A".repeat(64)}`,
    `/join/${"a".repeat(63)}`,
    `/join/${"g".repeat(64)}`,
    `/join/${"a".repeat(64)}/extra`,
    `/join%2f${"a".repeat(64)}`,
    `/join%5C${"a".repeat(64)}`,
    "/login%2Fcontinue",
  ])("rejects a malformed invitation continuation: %s", (value) => {
    expect(safeReturnTo(value)).toBe("/groups");
  });

  it.each([
    "https://attacker.example/groups",
    "//attacker.example/groups",
    "/\\attacker.example/groups",
    "\\\\attacker.example\\groups",
    "groups/friends",
    " /groups/friends",
    "/groups/friends\n",
  ])("rejects an unsafe redirect target: %s", (value) => {
    expect(safeReturnTo(value)).toBe("/groups");
  });

  it.each([
    "/login",
    "/login/",
    "/login?returnTo=%2Fgroups",
    "/join",
    "/join/",
    "/auth",
    "/auth/callback?next=/groups",
    "/auth/confirm?token_hash=secret",
  ])("rejects an authentication redirect loop: %s", (value) => {
    expect(safeReturnTo(value, "/groups/fallback")).toBe("/groups/fallback");
  });

  it("falls back to /groups when the supplied fallback is unsafe", () => {
    expect(safeReturnTo("https://attacker.example", "//also-bad.example")).toBe(
      "/groups",
    );
  });
});
