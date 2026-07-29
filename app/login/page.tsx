import type { Metadata } from "next";
import Link from "next/link";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { LoginForm } from "@/app/components/auth/LoginForm";
import { loginAction } from "@/app/login/actions";
import { safeReturnTo } from "@/lib/auth/redirect";

export const metadata: Metadata = {
  title: "ログイン | 推し輪",
  robots: {
    index: false,
    follow: false,
  },
};

type LoginPageProps = {
  searchParams?: Promise<{
    returnTo?: string | string[];
    status?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps = {}) {
  const query = (await searchParams) ?? {};
  const returnTo = safeReturnTo(
    typeof query.returnTo === "string" ? query.returnTo : null,
    "/groups",
  );
  const status = typeof query.status === "string" ? query.status : null;
  const confirmationFailed = status === "confirmation-failed";
  const signupConfirmationFailed = status === "signup-confirmation-failed";

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <AuthBrand />

        <div className="auth-heading">
          <p className="eyebrow" lang="en">
            WELCOME BACK
          </p>
          <h1 id="login-title">ログイン</h1>
          <p>メールアドレスとパスワードでログインします。</p>
        </div>

        {confirmationFailed ? (
          <p className="auth-status is-error" role="alert">
            招待を確認できませんでした。管理者に招待の再発行を依頼してください。
          </p>
        ) : null}
        {signupConfirmationFailed ? (
          <p className="auth-status is-error" role="alert">
            確認リンクの期限が切れているようです。もう一度登録するか、ログインをお試しください。
          </p>
        ) : null}
        <LoginForm action={loginAction} returnTo={returnTo} />
        <Link className="auth-text-link" href="/password/reset">
          パスワードをお忘れの方はこちら
        </Link>
        <Link
          className="auth-text-link"
          href={`/signup?returnTo=${encodeURIComponent(returnTo)}`}
        >
          はじめての方はアカウントを作る
        </Link>
        <Link className="auth-text-link" href="/join">
          メールで招待を受け取った方はこちら
        </Link>
      </section>
    </main>
  );
}
