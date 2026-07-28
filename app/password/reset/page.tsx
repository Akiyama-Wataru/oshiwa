import type { Metadata } from "next";
import Link from "next/link";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { PasswordResetRequestForm } from "@/app/components/auth/PasswordResetRequestForm";
import { requestPasswordResetAction } from "@/app/password/actions";

export const metadata: Metadata = {
  title: "パスワードの再設定 | 推し輪",
  robots: { index: false, follow: false },
};

type PasswordResetPageProps = {
  searchParams?: Promise<{ status?: string | string[] }>;
};

export default async function PasswordResetPage({
  searchParams,
}: PasswordResetPageProps = {}) {
  const query = (await searchParams) ?? {};
  const linkExpired = query.status === "link-expired";

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="password-reset-title">
        <AuthBrand />

        <div className="auth-heading">
          <p className="eyebrow" lang="en">
            RESET PASSWORD
          </p>
          <h1 id="password-reset-title">パスワードの再設定</h1>
          <p>登録済みのメールアドレスに再設定用のリンクを送ります。</p>
        </div>

        {linkExpired ? (
          <p className="auth-status is-error" role="alert">
            リンクの有効期限が切れています。もう一度メールを送信してください。
          </p>
        ) : null}

        <PasswordResetRequestForm action={requestPasswordResetAction} />

        <Link className="auth-text-link" href="/login">
          ログイン画面へ戻る
        </Link>
      </section>
    </main>
  );
}
