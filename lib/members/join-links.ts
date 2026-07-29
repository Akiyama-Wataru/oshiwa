import { type MembershipRole, MEMBERSHIP_ROLES } from "@/lib/members/roster";
import { lowercaseUuid } from "@/lib/validation/identifiers";

export type LiveJoinLink = {
  id: string;
  role: MembershipRole;
  expiresAt: string;
};

const identifier = lowercaseUuid("有効な識別子ではありません。");

/**
 * Only the links somebody could still walk through. A spent, revoked or expired
 * link is history: listing it beside a "revoke" button would say it were still
 * open.
 */
export function normalizeJoinLinkRows(
  value: unknown,
  now: number = Date.now(),
): LiveJoinLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return [];
    }

    const row = candidate as Record<string, unknown>;
    const parsedId = identifier.safeParse(row.id);
    const role = row.role;
    const expiresAt = row.expires_at;

    if (
      !parsedId.success ||
      typeof expiresAt !== "string" ||
      Number.isNaN(Date.parse(expiresAt)) ||
      !MEMBERSHIP_ROLES.includes(role as MembershipRole)
    ) {
      return [];
    }

    if (
      row.revoked_at !== null ||
      row.accepted_at !== null ||
      Date.parse(expiresAt) <= now
    ) {
      return [];
    }

    return [
      {
        id: parsedId.data,
        role: role as MembershipRole,
        expiresAt,
      },
    ];
  });
}
