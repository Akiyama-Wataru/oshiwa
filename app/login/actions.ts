"use server";

import { redirect } from "next/navigation";

import { mapLoginError } from "@/lib/auth/login-errors";
import { safeReturnTo } from "@/lib/auth/redirect";
import { SupabaseConfigurationError } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validation/auth";

export type LoginActionState = {
  status: "idle" | "error";
  message: string;
};

export type LoginAction = (
  state: LoginActionState,
  formData: FormData,
) => Promise<LoginActionState>;

const INVALID_LOGIN_MESSAGE =
  "メールアドレスまたはパスワードが正しくありません。";
const PREVIEW_MESSAGE =
  "このローカルプレビューでは認証接続が未設定です。Supabaseを設定するとログインできます。";

export async function loginAction(
  _state: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { status: "error", message: INVALID_LOGIN_MESSAGE };
  }

  const destination = safeReturnTo(formData.get("returnTo"), "/groups");

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);

    if (error) {
      const mapped = mapLoginError(error);
      return { status: "error", message: mapped.message };
    }
  } catch (error) {
    if (
      error instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return { status: "error", message: PREVIEW_MESSAGE };
    }

    const mapped = mapLoginError(error);
    return { status: "error", message: mapped.message };
  }

  redirect(destination);
}
