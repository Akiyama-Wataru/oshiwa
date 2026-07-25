"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseConfigurationError } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inviteTokenSchema } from "@/lib/validation/auth";
import {
  createGroupSchema,
  createInvitationSchema,
  groupIdSchema,
  siteUrlSchemaForMode,
} from "@/lib/validation/groups";

export type LogoutActionState = {
  status: "idle" | "error";
  message: string;
};

export type LogoutAction = (
  state: LogoutActionState,
  formData: FormData,
) => Promise<LogoutActionState>;

export type CreateGroupActionState = {
  status: "idle" | "error";
  message: string;
};

export type CreateGroupAction = (
  state: CreateGroupActionState,
  formData: FormData,
) => Promise<CreateGroupActionState>;

export type InviteMemberActionState = {
  status: "idle" | "success" | "warning" | "error";
  message: string;
  manualLink: string | null;
};

export type InviteMemberAction = (
  state: InviteMemberActionState,
  formData: FormData,
) => Promise<InviteMemberActionState>;

const GROUP_ERROR =
  "グループを作成できませんでした。しばらく待ってからお試しください。";
const INVITE_ERROR =
  "招待を作成できませんでした。入力内容を確認してもう一度お試しください。";
const DELIVERY_WARNING =
  "招待メールを送信できませんでした。手動リンクを安全な方法で共有してください。";

export async function createGroupAction(
  _state: CreateGroupActionState,
  formData: FormData,
): Promise<CreateGroupActionState> {
  const parsed = createGroupSchema.safeParse({ name: formData.get("name") });

  if (!parsed.success) {
    return {
      status: "error",
      message: "グループ名は1〜100文字で入力してください。",
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.rpc("create_group", {
      group_name: parsed.data.name,
    });

    if (error) {
      return { status: "error", message: GROUP_ERROR };
    }
  } catch (error) {
    if (
      error instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return {
        status: "error",
        message: "ローカルプレビューではグループ作成が未設定です。",
      };
    }

    return { status: "error", message: GROUP_ERROR };
  }

  revalidatePath("/groups");
  redirect("/groups?created=1");
}

async function updateDeliveryState(
  admin: SupabaseClient,
  invitationId: string,
  deliveryState: "sent" | "failed",
) {
  const { error } = await admin
    .from("invitations")
    .update({ delivery_state: deliveryState })
    .eq("id", invitationId);
  return error;
}

async function markDeliveryFailed(
  authenticated: SupabaseClient,
  invitationId: string,
) {
  try {
    await authenticated.rpc("mark_invitation_delivery_failed", {
      invitation_id: invitationId,
    });
  } catch {
    // Best effort: a total database outage cannot be compensated in-band.
  }
}

export async function inviteMemberAction(
  _state: InviteMemberActionState,
  formData: FormData,
): Promise<InviteMemberActionState> {
  const parsed = createInvitationSchema.safeParse({
    groupId: formData.get("groupId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { status: "error", message: INVITE_ERROR, manualLink: null };
  }

  let invitationId: string;
  let rawToken: string;
  let authenticated: SupabaseClient;

  try {
    authenticated = await createServerSupabaseClient();
    const { data, error } = await authenticated.rpc("create_invitation", {
      target_group_id: parsed.data.groupId,
      invitee_email: parsed.data.email,
      invited_role: parsed.data.role,
    });

    if (error || !Array.isArray(data) || !data[0]) {
      return { status: "error", message: INVITE_ERROR, manualLink: null };
    }

    const idResult = groupIdSchema.safeParse(data[0].invitation_id);
    const tokenResult = inviteTokenSchema.safeParse(data[0].invite_token);

    if (!idResult.success || !tokenResult.success) {
      return { status: "error", message: INVITE_ERROR, manualLink: null };
    }

    invitationId = idResult.data;
    rawToken = tokenResult.data;
  } catch {
    return { status: "error", message: INVITE_ERROR, manualLink: null };
  }

  const manualLink = `/join/${rawToken}`;
  let admin: SupabaseClient;

  try {
    admin = createAdminSupabaseClient();
  } catch {
    await markDeliveryFailed(authenticated, invitationId);
    return { status: "warning", message: DELIVERY_WARNING, manualLink };
  }

  const siteUrl = siteUrlSchemaForMode(process.env.NODE_ENV).safeParse(
    process.env.NEXT_PUBLIC_SITE_URL,
  );

  if (!siteUrl.success) {
    await updateDeliveryState(admin, invitationId, "failed").catch(() => null);
    await markDeliveryFailed(authenticated, invitationId);
    return { status: "warning", message: DELIVERY_WARNING, manualLink };
  }

  let deliveryState: "sent" | "failed" = "failed";

  try {
    const { error } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email,
      {
        redirectTo: `${siteUrl.data}/join/${rawToken}?setup=1`,
      },
    );
    deliveryState = error ? "failed" : "sent";
  } catch {
    deliveryState = "failed";
  }

  const stateUpdateError = await updateDeliveryState(
    admin,
    invitationId,
    deliveryState,
  ).catch(() => true);

  revalidatePath("/groups");

  if (deliveryState === "failed" || stateUpdateError) {
    await markDeliveryFailed(authenticated, invitationId);
    return { status: "warning", message: DELIVERY_WARNING, manualLink };
  }

  return {
    status: "success",
    message:
      "招待メールを送信しました。届かない場合は手動リンクを共有してください。",
    manualLink,
  };
}

export async function logoutAction(): Promise<LogoutActionState> {
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      return {
        status: "error",
        message: "ログアウトできませんでした。もう一度お試しください。",
      };
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof SupabaseConfigurationError &&
        process.env.NODE_ENV !== "production"
          ? "ローカルプレビューでは認証接続が未設定です。"
          : "ログアウトできませんでした。もう一度お試しください。",
    };
  }

  redirect("/login");
}
