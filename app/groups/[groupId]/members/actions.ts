"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  reportFailure,
  resolveServerClient,
} from "@/lib/supabase/action-support";
import {
  changeMemberRoleSchema,
  memberGroupIdSchema,
  removeMemberSchema,
  revokeInvitationSchema,
} from "@/lib/validation/members";

export type MemberActionState = {
  status: "idle" | "success" | "warning" | "error";
  message: string;
};

export type MemberAction = (
  state: MemberActionState,
  formData: FormData,
) => Promise<MemberActionState>;

const SCOPE = "members";

const ROLE_ERROR =
  "権限を変更できませんでした。オーナーだけが権限を変更できます。";
const LAST_OWNER_ERROR =
  "最後のオーナーは権限を変更したり外したりできません。先に別のオーナーを立ててください。";
const REMOVE_ERROR =
  "メンバーを外せませんでした。権限を確認してもう一度お試しください。";
const LEAVE_ERROR = "この輪から抜けられませんでした。もう一度お試しください。";
const REVOKE_ERROR =
  "招待を取り消せませんでした。すでに使われているか期限が切れている可能性があります。";
const LOCAL_PREVIEW_ERROR =
  "ローカルプレビューではメンバー管理が未設定です。";

function membersPath(groupId: string): string {
  return `/groups/${groupId}/members`;
}

async function resolveClient(fallbackMessage: string) {
  return resolveServerClient({
    fallbackMessage,
    localPreviewMessage: LOCAL_PREVIEW_ERROR,
  });
}

/**
 * The database is the only place that knows whether a group still has another
 * owner, so its refusal is what the member is told about. The message names the
 * rule rather than repeating the database's words.
 */
function describeFailure(cause: unknown, fallback: string): string {
  const detail =
    cause && typeof cause === "object" && "message" in cause
      ? String((cause as { message: unknown }).message)
      : "";

  return /last owner/iu.test(detail) ? LAST_OWNER_ERROR : fallback;
}

export async function changeMemberRoleAction(
  _state: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = changeMemberRoleSchema.safeParse({
    groupId: formData.get("groupId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { status: "error", message: ROLE_ERROR };
  }

  const resolution = await resolveClient(ROLE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("change_member_role", {
    target_group_id: parsed.data.groupId,
    member_user_id: parsed.data.userId,
    new_role: parsed.data.role,
  });

  if (error || data !== true) {
    reportFailure(SCOPE, "change_member_role", error ?? "refused");
    return { status: "error", message: describeFailure(error, ROLE_ERROR) };
  }

  revalidatePath(membersPath(parsed.data.groupId));

  return { status: "success", message: "権限を変更しました。" };
}

export async function removeMemberAction(
  _state: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = removeMemberSchema.safeParse({
    groupId: formData.get("groupId"),
    userId: formData.get("userId"),
  });

  if (!parsed.success) {
    return { status: "error", message: REMOVE_ERROR };
  }

  const resolution = await resolveClient(REMOVE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("remove_member", {
    target_group_id: parsed.data.groupId,
    member_user_id: parsed.data.userId,
  });

  if (error || data !== true) {
    reportFailure(SCOPE, "remove_member", error ?? "refused");
    return { status: "error", message: describeFailure(error, REMOVE_ERROR) };
  }

  revalidatePath(membersPath(parsed.data.groupId));

  return { status: "success", message: "メンバーを外しました。" };
}

export async function leaveGroupAction(
  _state: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const group = memberGroupIdSchema.safeParse(formData.get("groupId"));

  if (!group.success) {
    return { status: "error", message: LEAVE_ERROR };
  }

  const resolution = await resolveClient(LEAVE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  // Whose membership ends is read from the session, never from the form: a
  // user id in the submission would let one member post another one out.
  const {
    data: { user },
    error: userError,
  } = await resolution.client.auth.getUser();

  if (userError || !user) {
    return { status: "error", message: LEAVE_ERROR };
  }

  const { data, error } = await resolution.client.rpc("remove_member", {
    target_group_id: group.data,
    member_user_id: user.id,
  });

  if (error || data !== true) {
    reportFailure(SCOPE, "remove_member(self)", error ?? "refused");
    return { status: "error", message: describeFailure(error, LEAVE_ERROR) };
  }

  revalidatePath("/groups");

  redirect("/groups");
}

export async function revokeInvitationAction(
  _state: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = revokeInvitationSchema.safeParse({
    groupId: formData.get("groupId"),
    invitationId: formData.get("invitationId"),
  });

  if (!parsed.success) {
    return { status: "error", message: REVOKE_ERROR };
  }

  const resolution = await resolveClient(REVOKE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("revoke_invitation", {
    invitation_id: parsed.data.invitationId,
  });

  if (error || data !== true) {
    reportFailure(SCOPE, "revoke_invitation", error ?? "refused");
    return { status: "error", message: REVOKE_ERROR };
  }

  revalidatePath(membersPath(parsed.data.groupId));

  return { status: "success", message: "招待を取り消しました。" };
}
