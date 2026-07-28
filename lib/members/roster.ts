import { lowercaseUuid } from "@/lib/validation/identifiers";
import { UNSAFE_DISPLAY_CHARACTER_PATTERN } from "@/lib/validation/text";

export const MEMBERSHIP_ROLES = ["owner", "admin", "member"] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export type RosterViewer = {
  userId: string;
  role: MembershipRole;
};

export type RosterMember = {
  userId: string;
  displayName: string;
  role: MembershipRole;
  isSelf: boolean;
  canChangeRole: boolean;
  canRemove: boolean;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: MembershipRole;
  expiresAt: string;
  deliveryFailed: boolean;
};

/** Managers first, so the people who can act are at the top of the list. */
const ROLE_RANK: Record<MembershipRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "オーナー",
  admin: "管理者",
  member: "メンバー",
};

const identifier = lowercaseUuid("有効な識別子ではありません。");

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readIdentifier(value: unknown): string | null {
  const parsed = identifier.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readRole(value: unknown): MembershipRole | null {
  return typeof value === "string" &&
    (MEMBERSHIP_ROLES as readonly string[]).includes(value)
    ? (value as MembershipRole)
    : null;
}

function readDisplayName(value: unknown): string | null {
  const relation = Array.isArray(value) ? value[0] : value;
  const profile = readRecord(relation);
  const name =
    typeof profile?.display_name === "string" ? profile.display_name.trim() : "";

  return name.length > 0 && !UNSAFE_DISPLAY_CHARACTER_PATTERN.test(name)
    ? name
    : null;
}

function readTimestamp(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

/**
 * Rows arrive from PostgREST as unknown JSON. Anything that does not match the
 * shape the database guarantees is dropped rather than rendered.
 *
 * The permissions mirror the rules the RPCs enforce rather than approximating
 * them. Offering a control the database will refuse is worse than not offering
 * it: the member reads the refusal as the app being broken.
 */
export function normalizeMembershipRows(
  value: unknown,
  viewer: RosterViewer,
): RosterMember[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows = value.flatMap((candidate) => {
    const membership = readRecord(candidate);

    if (!membership) {
      return [];
    }

    const userId = readIdentifier(membership.user_id);
    const role = readRole(membership.role);
    const displayName = readDisplayName(membership.profiles);

    return userId && role && displayName ? [{ userId, role, displayName }] : [];
  });

  const ownerCount = rows.filter((row) => row.role === "owner").length;

  return rows
    .map((row) => {
      const isSelf = row.userId === viewer.userId;
      // The last owner can be neither demoted nor removed, by anyone, ever.
      const isLastOwner = row.role === "owner" && ownerCount <= 1;
      const viewerIsOwner = viewer.role === "owner";

      return {
        ...row,
        isSelf,
        canChangeRole: viewerIsOwner && !isLastOwner,
        canRemove:
          !isLastOwner &&
          (isSelf ||
            viewerIsOwner ||
            // An admin may see a manager out only by leaving themselves.
            (viewer.role === "admin" && row.role === "member")),
      };
    })
    .sort(
      (first, second) =>
        ROLE_RANK[first.role] - ROLE_RANK[second.role] ||
        first.displayName.localeCompare(second.displayName, "ja"),
    );
}

/**
 * Only the invitations somebody could still accept. A revoked, accepted or
 * expired row is history, and offering to revoke it again would suggest it was
 * still outstanding.
 */
export function normalizeInvitationRows(value: unknown): PendingInvitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const now = Date.now();

  return value.flatMap((candidate) => {
    const invitation = readRecord(candidate);

    if (!invitation) {
      return [];
    }

    const id = readIdentifier(invitation.id);
    const role = readRole(invitation.role);
    const expiresAt = readTimestamp(invitation.expires_at);
    const email =
      typeof invitation.email_normalized === "string"
        ? invitation.email_normalized
        : null;

    if (
      !id ||
      !role ||
      !expiresAt ||
      !email ||
      invitation.revoked_at !== null ||
      invitation.accepted_at !== null ||
      Date.parse(expiresAt) <= now
    ) {
      return [];
    }

    return [
      {
        id,
        email,
        role,
        expiresAt,
        deliveryFailed: invitation.delivery_state === "failed",
      },
    ];
  });
}
