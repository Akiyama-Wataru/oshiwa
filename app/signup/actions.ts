"use server";

import { redirect } from "next/navigation";

import { safeReturnTo } from "@/lib/auth/redirect";
import { SupabaseConfigurationError } from "@/lib/env";
import { reportFailure } from "@/lib/supabase/action-support";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signupSchema } from "@/lib/validation/auth";
import { siteUrlSchemaForMode } from "@/lib/validation/groups";

export type SignupActionState = {
  status: "idle" | "error" | "confirm";
  message: string;
};

export type SignupAction = (
  state: SignupActionState,
  formData: FormData,
) => Promise<SignupActionState>;

const SCOPE = "signup";

const SIGNUP_ERROR =
  "登録できませんでした。入力内容を確認してもう一度お試しください。";
const TAKEN_MESSAGE =
  "このメールアドレスは登録済みです。ログインしてください。";
const CONFIRM_MESSAGE =
  "確認メールを送りました。メール内のリンクを開くと登録が完了します。";
const PREVIEW_MESSAGE =
  "このローカルプレビューでは認証接続が未設定です。Supabaseを設定すると登録できます。";

export async function signupAction(
  _state: SignupActionState,
  formData: FormData,
): Promise<SignupActionState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? SIGNUP_ERROR,
    };
  }

  const destination = safeReturnTo(formData.get("returnTo"), "/groups");
  const siteUrl = siteUrlSchemaForMode(process.env.NODE_ENV).safeParse(
    process.env.NEXT_PUBLIC_SITE_URL,
  );

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { display_name: parsed.data.displayName },
        // Said explicitly rather than left to the project's Site URL, so that
        // a confirmation opened from a local sign up comes back to the local
        // app, and so that whoever confirms lands where they were heading.
        ...(siteUrl.success
          ? {
              emailRedirectTo: `${siteUrl.data}/auth/confirm?next=${encodeURIComponent(destination)}`,
            }
          : {}),
      },
    });

    if (error) {
      reportFailure(SCOPE, "signUp", error);

      return {
        status: "error",
        message: /already|registered|exists/iu.test(error.message)
          ? TAKEN_MESSAGE
          : SIGNUP_ERROR,
      };
    }

    // With email confirmation turned off Supabase hands back a session and the
    // new member is already signed in. With it turned on there is no session
    // yet, and saying "welcome" would strand them on a screen they cannot use.
    if (!data.session) {
      return { status: "confirm", message: CONFIRM_MESSAGE };
    }
  } catch (error) {
    if (
      error instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return { status: "error", message: PREVIEW_MESSAGE };
    }

    reportFailure(SCOPE, "signUp", error);
    return { status: "error", message: SIGNUP_ERROR };
  }

  redirect(destination);
}
