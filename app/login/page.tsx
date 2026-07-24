import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ログイン | 推し輪",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <Link className="auth-brand" href="/" aria-label="推し輪のホームへ戻る">
          <span className="brand-mark" aria-hidden="true">
            推
          </span>
          <span>推し輪</span>
        </Link>

        <div className="auth-heading">
          <p className="eyebrow" lang="en">
            WELCOME BACK
          </p>
          <h1 id="login-title">ログイン</h1>
          <p>招待されたメールアドレスでログインします。</p>
        </div>

        <form className="auth-form" aria-describedby="login-status">
          <label>
            メールアドレス
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
            />
          </label>
          <label>
            パスワード
            <input
              type="password"
              name="password"
              autoComplete="current-password"
            />
          </label>
          <button className="button button-primary" type="submit" disabled>
            ログインする
          </button>
        </form>

        <p className="auth-status" id="login-status">
          認証機能を安全に接続中です。フェーズ2で有効になります。
        </p>
        <Link className="auth-text-link" href="/join">
          招待を受け取った方はこちら
        </Link>
      </section>
    </main>
  );
}
