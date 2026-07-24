import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "招待に参加 | 推し輪",
  robots: {
    index: false,
    follow: false,
  },
};

export default function JoinPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="join-title">
        <Link className="auth-brand" href="/" aria-label="推し輪のホームへ戻る">
          <span className="brand-mark" aria-hidden="true">
            推
          </span>
          <span>推し輪</span>
        </Link>

        <div className="auth-heading">
          <p className="eyebrow" lang="en">
            PRIVATE INVITATION
          </p>
          <h1 id="join-title">招待に参加</h1>
          <p>
            推し輪は身内だけの招待制です。グループの管理者から届いた招待リンクを開いて参加してください。
          </p>
        </div>

        <div className="invite-note">
          <span aria-hidden="true">✦</span>
          <p>
            招待リンクには有効期限があります。期限が切れた場合は、管理者へ再発行をお願いしてください。
          </p>
        </div>

        <Link className="button button-secondary auth-back" href="/login">
          ログインへ戻る
        </Link>
      </section>
    </main>
  );
}
