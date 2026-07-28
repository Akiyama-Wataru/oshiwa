import { describe, expect, it } from "vitest";

import {
  isLinkEstablishedSession,
  sessionSecurityMethod,
} from "@/lib/auth/session-method";

describe("sessionSecurityMethod", () => {
  it("reads the method from either shape Supabase writes", () => {
    expect(sessionSecurityMethod({ amr: ["password"] })).toBe("password");
    expect(sessionSecurityMethod({ amr: [{ method: "recovery" }] })).toBe(
      "recovery",
    );
  });

  it("looks past the refreshes that only extend a session", () => {
    expect(
      sessionSecurityMethod({
        amr: [{ method: "invite" }, { method: "token_refresh" }],
      }),
    ).toBe("invite");
  });

  it("calls a session it cannot pin down unknown rather than guessing", () => {
    for (const claims of [
      null,
      "password",
      {},
      { amr: [] },
      { amr: "password" },
      { amr: [{ method: 7 }] },
      // Two security methods: there is no safe way to tell which one the
      // caller is relying on, so neither is assumed.
      { amr: [{ method: "password" }, { method: "recovery" }] },
    ]) {
      expect(sessionSecurityMethod(claims)).toBe(null);
    }
  });
});

describe("isLinkEstablishedSession", () => {
  it("accepts a session an emailed link established", () => {
    expect(isLinkEstablishedSession({ amr: [{ method: "recovery" }] })).toBe(
      true,
    );
    expect(isLinkEstablishedSession({ amr: [{ method: "invite" }] })).toBe(true);
    // A method this app has not heard of still cannot have come from a typed
    // password, and refusing it would lock out the people with no other way in.
    expect(isLinkEstablishedSession({ amr: [{ method: "magiclink" }] })).toBe(
      true,
    );
  });

  it("refuses a session somebody typed a password into", () => {
    expect(isLinkEstablishedSession({ amr: ["password"] })).toBe(false);
  });

  it("refuses a session it cannot account for", () => {
    expect(isLinkEstablishedSession({})).toBe(false);
    expect(isLinkEstablishedSession(null)).toBe(false);
  });
});
