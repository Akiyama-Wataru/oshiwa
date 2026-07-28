import { z } from "zod";

import { MEMBERSHIP_ROLES } from "@/lib/members/roster";
import { lowercaseUuid } from "@/lib/validation/identifiers";

export const memberGroupIdSchema = lowercaseUuid(
  "有効なグループを選択してください。",
);
export const memberUserIdSchema = lowercaseUuid(
  "有効なメンバーを選択してください。",
);
export const invitationIdSchema = lowercaseUuid(
  "有効な招待を選択してください。",
);

export const membershipRoleSchema = z.enum(
  MEMBERSHIP_ROLES,
  "用意された権限から選んでください。",
);

export const changeMemberRoleSchema = z.object({
  groupId: memberGroupIdSchema,
  userId: memberUserIdSchema,
  role: membershipRoleSchema,
});

export const removeMemberSchema = z.object({
  groupId: memberGroupIdSchema,
  userId: memberUserIdSchema,
});

export const revokeInvitationSchema = z.object({
  groupId: memberGroupIdSchema,
  invitationId: invitationIdSchema,
});

export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
