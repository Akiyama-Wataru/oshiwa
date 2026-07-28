import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { PasswordUpdateForm } from "@/app/components/auth/PasswordUpdateForm";
import { updatePasswordAction } from "@/app/password/actions";
import { isLinkEstablishedSession } from "@/lib/auth/session-method";
import { SupabaseConfigurationError } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "新しいパスワード | 推し輪",
  robots: { index: false, follow: false },
};

const EXPIRED_LINK = "/password/reset?status=link-expired";

/**
 * The action is the authority on who may set a password; this only decides
 * whether showing the form is honest. Sending someone away from a form that
 * would refuse them anyway is kinder than letting them type a password twice
 * to be told no.
 */
async function hasRecoverySession(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return false;
  }

  const { data, error } = await supabase.auth.getClaims();

  return !error && isLinkEstablishedSession(data?.claims);
}

export default async function PasswordUpdatePage() {
  try {
    if (!(await hasRecoverySession())) {
      redirect(EXPIRED_LINK);
    }
  } catch (caught) {
    if (
      caught instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return (
        <main className="auth-shell">
          <section
            className="auth-card"
            aria-labelledby="password-update-title"
          >
            <AuthBrand />
            <div className="auth-heading">
              <p className="eyebrow" lang="en">
                LOCAL PREVIEW
              </p>
              <h1 id="password-update-title">認証接続が未設定です</h1>
              <p>Supabaseを設定すると、パスワードを再設定できます。</p>
            </div>
          </section>
        </main>
      );
    }

    throw caught;
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="password-update-title">
        <AuthBrand />

        <div className="auth-heading">
          <p className="eyebrow" lang="en">
            NEW PASSWORD
          </p>
          <h1 id="password-update-title">新しいパスワードを設定</h1>
          <p>設定するとそのままログインした状態になります。</p>
        </div>

        <PasswordUpdateForm action={updatePasswordAction} />
      </section>
    </main>
  );
}
