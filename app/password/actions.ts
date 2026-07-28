"use server";

import { redirect } from "next/navigation";

import { SupabaseConfigurationError } from "@/lib/env";
import { isLinkEstablishedSession } from "@/lib/auth/session-method";
import { reportFailure } from "@/lib/supabase/action-support";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resetRequestSchema, setPasswordSchema } from "@/lib/validation/auth";
import { siteUrlSchemaForMode } from "@/lib/validation/groups";

export type PasswordActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type PasswordAction = (
  state: PasswordActionState,
  formData: FormData,
) => Promise<PasswordActionState>;

const SCOPE = "password";

/**
 * The same answer whether or not the address belongs to a member. Saying "no
 * such account" here would turn an unauthenticated form into a way to test
 * whether a given person is in this circle.
 */
const RESET_SENT_MESSAGE =
  "再設定用のリンクを送信しました。メールが届かない場合は迷惑メールもご確認ください。";
const ADDRESS_ERROR = "有効なメールアドレスを入力してください。";
const UPDATE_ERROR =
  "パスワードを変更できませんでした。もう一度お試しください。";
const LINK_REQUIRED_ERROR =
  "リンクの有効期限が切れています。もう一度再設定をやり直してください。";
const PASSWORD_RULE_ERROR = "パスワードは12〜128文字で入力してください。";
const PASSWORD_MISMATCH_ERROR = "パスワードが一致しません。";
const PREVIEW_MESSAGE =
  "このローカルプレビューではパスワード再設定が未設定です。Supabaseを設定してお試しください。";

function isPreviewFailure(error: unknown): boolean {
  return (
    error instanceof SupabaseConfigurationError &&
    process.env.NODE_ENV !== "production"
  );
}

export async function requestPasswordResetAction(
  _state: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  const parsed = resetRequestSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { status: "error", message: ADDRESS_ERROR };
  }

  const siteUrl = siteUrlSchemaForMode(process.env.NODE_ENV).safeParse(
    process.env.NEXT_PUBLIC_SITE_URL,
  );

  if (!siteUrl.success) {
    reportFailure(SCOPE, "site-url", siteUrl.error);
    return { status: "error", message: UPDATE_ERROR };
  }

  try {
    const supabase = await createServerSupabaseClient();
    // The link comes back through the same confirm route as an invitation, so
    // the one-time token is exchanged on the server and never in the browser.
    const { error } = await supabase.auth.resetPasswordForEmail(
      parsed.data.email,
      {
        redirectTo: `${siteUrl.data}/auth/confirm?next=${encodeURIComponent("/password/update")}`,
      },
    );

    if (error) {
      // Recorded, never shown: the member is told the same thing either way.
      reportFailure(SCOPE, "resetPasswordForEmail", error);
    }
  } catch (error) {
    if (isPreviewFailure(error)) {
      return { status: "error", message: PREVIEW_MESSAGE };
    }

    reportFailure(SCOPE, "resetPasswordForEmail", error);
  }

  return { status: "success", message: RESET_SENT_MESSAGE };
}

export async function updatePasswordAction(
  _state: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  const parsed = setPasswordSchema.safeParse({
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { status: "error", message: PASSWORD_RULE_ERROR };
  }

  if (parsed.data.password !== formData.get("passwordConfirmation")) {
    return { status: "error", message: PASSWORD_MISMATCH_ERROR };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { status: "error", message: LINK_REQUIRED_ERROR };
    }

    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();

    // Only a session the emailed link established may set a new password. A
    // signed in session must not be able to replace it, or a stolen one could
    // lock the owner out of an account whose password it never knew.
    if (claimsError || !isLinkEstablishedSession(claimsData?.claims)) {
      return { status: "error", message: LINK_REQUIRED_ERROR };
    }

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });

    if (error) {
      reportFailure(SCOPE, "updateUser", error);
      return { status: "error", message: UPDATE_ERROR };
    }
  } catch (error) {
    if (isPreviewFailure(error)) {
      return { status: "error", message: PREVIEW_MESSAGE };
    }

    reportFailure(SCOPE, "updateUser", error);
    return { status: "error", message: UPDATE_ERROR };
  }

  redirect("/groups");
}
