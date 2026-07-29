import { z } from "zod";

import { lowercaseUuid } from "@/lib/validation/identifiers";
import { memberGroupIdSchema } from "@/lib/validation/members";

/** The lifetimes a manager may pick, in hours. The database caps this at 7 days. */
export const JOIN_LINK_LIFETIME_HOURS = [1, 24, 168] as const;

export const JOIN_LINK_LIFETIME_LABELS: Record<number, string> = {
  1: "1時間",
  24: "24時間",
  168: "7日間",
};

export const joinLinkIdSchema = lowercaseUuid(
  "有効な参加リンクを選択してください。",
);

/**
 * The same shape as the invitation token: 256 bits, hex. Anything else is
 * refused before it reaches the database, so a mistyped link fails here rather
 * than as a lookup that finds nothing.
 */
export const joinLinkTokenSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-f0-9]{64}$/u, "参加リンクの形式が正しくありません。");

export const joinLinkRoleSchema = z.enum(
  ["admin", "member"],
  "参加リンクで渡せるのは管理者かメンバーだけです。",
);

export const createJoinLinkSchema = z.object({
  groupId: memberGroupIdSchema,
  role: joinLinkRoleSchema,
  lifetimeHours: z.coerce
    .number()
    .int()
    .refine(
      (hours): hours is (typeof JOIN_LINK_LIFETIME_HOURS)[number] =>
        JOIN_LINK_LIFETIME_HOURS.includes(
          hours as (typeof JOIN_LINK_LIFETIME_HOURS)[number],
        ),
      "用意された有効期限から選んでください。",
    ),
});

export const revokeJoinLinkSchema = z.object({
  groupId: memberGroupIdSchema,
  linkId: joinLinkIdSchema,
});

export const acceptJoinLinkSchema = z.object({
  token: joinLinkTokenSchema,
});

export function joinLinkPath(token: string): string {
  return `/invite/${joinLinkTokenSchema.parse(token)}`;
}
