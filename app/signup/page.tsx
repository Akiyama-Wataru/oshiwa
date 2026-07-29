import type { Metadata } from "next";
import Link from "next/link";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { SignupForm } from "@/app/components/auth/SignupForm";
import { signupAction } from "@/app/signup/actions";
import { safeReturnTo } from "@/lib/auth/redirect";

export const metadata: Metadata = {
  title: "登録 | 推し輪",
  robots: {
    index: false,
    follow: false,
  },
};

type SignupPageProps = {
  searchParams?: Promise<{
    returnTo?: string | string[];
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps = {}) {
  const query = (await searchParams) ?? {};
  // Somebody who arrived from a join link goes back to it once they have an
  // account, rather than landing on an empty list of circles.
  const returnTo = safeReturnTo(
    typeof query.returnTo === "string" ? query.returnTo : null,
    "/groups",
  );

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="signup-title">
        <AuthBrand />

        <div className="auth-heading">
          <p className="eyebrow" lang="en">
            CREATE ACCOUNT
          </p>
          <h1 id="signup-title">アカウントを作る</h1>
          <p>
            アカウントだけでは何も見えません。輪に入るには参加リンクが必要です。
          </p>
        </div>

        <SignupForm action={signupAction} returnTo={returnTo} />

        <Link
          className="auth-text-link"
          href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        >
          アカウントをお持ちの方はログイン
        </Link>
      </section>
    </main>
  );
}
