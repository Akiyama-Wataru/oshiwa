import { describe, expect, it } from "vitest";

import { invitationSessionMode } from "@/app/auth/invitation-session";

describe("invitationSessionMode", () => {
  it("derives manual acceptance only from a verified password AMR", () => {
    expect(
      invitationSessionMode({ amr: ["password", "token_refresh"] }),
    ).toBe("manual");
    expect(
      invitationSessionMode({
        amr: [{ method: "password", timestamp: 1 }],
      }),
    ).toBe("manual");
  });

  it("derives setup only from the exact invite authentication method", () => {
    expect(
      invitationSessionMode({ amr: ["invite", "token_refresh"] }),
    ).toBe("setup");
    expect(
      invitationSessionMode({
        amr: [{ method: "invite", timestamp: 1 }],
      }),
    ).toBe("setup");
  });

  it("rejects missing, malformed, and unrelated authentication methods", () => {
    expect(invitationSessionMode({})).toBeNull();
    expect(invitationSessionMode({ amr: ["oauth"] })).toBeNull();
    expect(invitationSessionMode({ amr: ["otp"] })).toBeNull();
    expect(invitationSessionMode({ amr: ["magiclink"] })).toBeNull();
    expect(invitationSessionMode({ amr: ["invite", "password"] })).toBeNull();
    expect(invitationSessionMode({ amr: [{ method: 42 }] })).toBeNull();
  });
});
