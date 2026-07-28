import { describe, expect, it } from "vitest";

import {
  normalizeInvitationRows,
  normalizeMembershipRows,
} from "@/lib/members/roster";

const owner = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const member = "33333333-3333-4333-8333-333333333333";
const secondOwner = "44444444-4444-4444-8444-444444444444";

function row(userId: string, role: string, displayName = "みお") {
  return { user_id: userId, role, profiles: { display_name: displayName } };
}

const roster = [
  row(owner, "owner", "おーな"),
  row(admin, "admin", "あどみん"),
  row(member, "member", "めんばー"),
];

describe("normalizeMembershipRows", () => {
  it("orders owners first and members last, then by name", () => {
    const entries = normalizeMembershipRows(
      [row(member, "member", "い"), row(owner, "owner"), row(admin, "admin")],
      { userId: member, role: "member" },
    );

    expect(entries.map((entry) => entry.role)).toEqual([
      "owner",
      "admin",
      "member",
    ]);
  });

  it("marks the viewer's own row", () => {
    const entries = normalizeMembershipRows(roster, {
      userId: admin,
      role: "admin",
    });

    expect(entries.filter((entry) => entry.isSelf)).toHaveLength(1);
    expect(entries.find((entry) => entry.isSelf)?.userId).toBe(admin);
  });

  it("lets only an owner change anybody's role", () => {
    const asOwner = normalizeMembershipRows([...roster, row(secondOwner, "owner")], {
      userId: owner,
      role: "owner",
    });
    const asAdmin = normalizeMembershipRows(roster, {
      userId: admin,
      role: "admin",
    });

    expect(asOwner.every((entry) => entry.canChangeRole)).toBe(true);
    expect(asAdmin.some((entry) => entry.canChangeRole)).toBe(false);
  });

  it("never offers to move the last owner out of the way", () => {
    const entries = normalizeMembershipRows(roster, {
      userId: owner,
      role: "owner",
    });
    const soleOwner = entries.find((entry) => entry.role === "owner");

    // The database refuses to demote or remove the last owner, so the form
    // must not invite someone to try.
    expect(soleOwner).toMatchObject({ canChangeRole: false, canRemove: false });
  });

  it("frees the owner controls once a second owner exists", () => {
    const entries = normalizeMembershipRows(
      [...roster, row(secondOwner, "owner", "ふたりめ")],
      { userId: owner, role: "owner" },
    );

    expect(
      entries
        .filter((entry) => entry.role === "owner")
        .every((entry) => entry.canChangeRole && entry.canRemove),
    ).toBe(true);
  });

  it("holds an admin to removing plain members and themselves", () => {
    const entries = normalizeMembershipRows(roster, {
      userId: admin,
      role: "admin",
    });
    const byRole = new Map(entries.map((entry) => [entry.role, entry]));

    expect(byRole.get("member")?.canRemove).toBe(true);
    expect(byRole.get("admin")?.canRemove).toBe(true);
    expect(byRole.get("owner")?.canRemove).toBe(false);
  });

  it("lets a plain member leave but touch nobody else", () => {
    const entries = normalizeMembershipRows(roster, {
      userId: member,
      role: "member",
    });

    for (const entry of entries) {
      expect(entry.canRemove).toBe(entry.isSelf);
      expect(entry.canChangeRole).toBe(false);
    }
  });

  it("drops rows the database could not have produced", () => {
    expect(
      normalizeMembershipRows(
        [
          row("not-a-uuid", "member"),
          { user_id: member, role: "sovereign" },
          { user_id: member },
          null,
          row(member, "member", "  "),
        ],
        { userId: owner, role: "owner" },
      ),
    ).toEqual([]);
    expect(normalizeMembershipRows(null, { userId: owner, role: "owner" })).toEqual(
      [],
    );
  });

  it("reads a profile that arrived as a single element relation", () => {
    const entries = normalizeMembershipRows(
      [{ user_id: member, role: "member", profiles: [{ display_name: "はな" }] }],
      { userId: owner, role: "owner" },
    );

    expect(entries[0].displayName).toBe("はな");
  });
});

describe("normalizeInvitationRows", () => {
  const invitationId = "55555555-5555-4555-8555-555555555555";
  const future = "2099-01-01T00:00:00+00:00";
  const past = "2020-01-01T00:00:00+00:00";

  function invitation(overrides: Record<string, unknown> = {}) {
    return {
      id: invitationId,
      email_normalized: "fan@example.com",
      role: "member",
      expires_at: future,
      revoked_at: null,
      accepted_at: null,
      delivery_state: "sent",
      ...overrides,
    };
  }

  it("keeps only the invitations that someone could still accept", () => {
    const entries = normalizeInvitationRows([
      invitation(),
      invitation({ revoked_at: past }),
      invitation({ accepted_at: past }),
      invitation({ expires_at: past }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: invitationId,
      email: "fan@example.com",
      role: "member",
    });
  });

  it("says when the invitation email never left", () => {
    const [entry] = normalizeInvitationRows([
      invitation({ delivery_state: "failed" }),
    ]);

    expect(entry.deliveryFailed).toBe(true);
  });

  it("drops rows it cannot read", () => {
    expect(
      normalizeInvitationRows([
        invitation({ id: "not-a-uuid" }),
        invitation({ email_normalized: 42 }),
        invitation({ expires_at: "whenever" }),
        null,
      ]),
    ).toEqual([]);
    expect(normalizeInvitationRows(undefined)).toEqual([]);
  });
});
