"use server";

import { redirect } from "next/navigation";

import { invitationSessionMode } from "@/app/auth/invitation-session";
import { SupabaseConfigurationError } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  inviteTokenSchema,
  setPasswordSchema,
} from "@/lib/validation/auth";

export type JoinActionState = {
  status: "idle" | "error";
  message: string;
};

export type JoinAction = (
  state: JoinActionState,
  formData: FormData,
) => Promise<JoinActionState>;

const INVITATION_ERROR =
  "招待を完了できませんでした。リンクを確認するか、管理者に再発行を依頼してください。";
const PASSWORD_SETUP_ERROR =
  "パスワードを設定できませんでした。もう一度お試しください。";
const PREVIEW_MESSAGE =
  "このローカルプレビューでは招待処理が未設定です。Supabaseを設定してお試しください。";

export async function joinAction(
  _state: JoinActionState,
  formData: FormData,
): Promise<JoinActionState> {
  const token = inviteTokenSchema.safeParse(formData.get("token"));
  const requestedMode = formData.get("mode");

  if (
    !token.success ||
    (requestedMode !== "setup" && requestedMode !== "manual")
  ) {
    return { status: "error", message: INVITATION_ERROR };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (
      userError ||
      !user?.email ||
      !user.email_confirmed_at
    ) {
      return { status: "error", message: INVITATION_ERROR };
    }

    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();
    const trustedMode = claimsError
      ? null
      : invitationSessionMode(claimsData?.claims);

    if (!trustedMode || trustedMode !== requestedMode) {
      return { status: "error", message: INVITATION_ERROR };
    }

    let setupPassword: string | null = null;

    if (trustedMode === "setup") {
      const password = setPasswordSchema.safeParse({
        password: formData.get("password"),
      });
      const confirmation = formData.get("passwordConfirmation");

      if (!password.success) {
        return {
          status: "error",
          message: "パスワードは12〜128文字で入力してください。",
        };
      }

      if (password.data.password !== confirmation) {
        return { status: "error", message: "パスワードが一致しません。" };
      }

      setupPassword = password.data.password;
    }

    const { error: invitationError } = await supabase.rpc(
      "accept_invitation",
      { invite_token: token.data },
    );

    if (invitationError) {
      return { status: "error", message: INVITATION_ERROR };
    }

    if (setupPassword) {
      try {
        const { error: passwordError } = await supabase.auth.updateUser({
          password: setupPassword,
        });

        if (passwordError) {
          return { status: "error", message: PASSWORD_SETUP_ERROR };
        }
      } catch {
        return { status: "error", message: PASSWORD_SETUP_ERROR };
      }
    }
  } catch (error) {
    if (
      error instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return { status: "error", message: PREVIEW_MESSAGE };
    }

    return { status: "error", message: INVITATION_ERROR };
  }

  redirect("/groups");
}
