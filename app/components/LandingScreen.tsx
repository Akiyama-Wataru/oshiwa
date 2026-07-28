import {
  Bell,
  Camera,
  Heart,
  Home,
  ImagePlus,
  LockKeyhole,
  MessageCircle,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import Link from "next/link";


const featureItems = [
  {
    icon: ImagePlus,
    title: "推しを何人でも",
    text: "グループみんなで推しを登録。写真もメンバーカラーも、ひと目で見つかります。",
    tone: "coral",
  },
  {
    icon: Camera,
    title: "今日の好きを残す",
    text: "画像・コメント・ハッシュタグをひとつに。大切な瞬間が流れて消えません。",
    tone: "lime",
  },
  {
    icon: MessageCircle,
    title: "身内だけで盛り上がる",
    text: "いいねと返信で気軽に反応。グループの外から投稿は見えません。",
    tone: "sky",
  },
] as const;

const navItems = [
  { icon: Home, label: "タイムライン", active: true },
  { icon: Star, label: "推し", active: false },
  { icon: ImagePlus, label: "投稿", active: false },
  { icon: Bell, label: "通知", active: false },
] as const;

export function LandingScreen() {
  return (
    <div className="landing-shell">
      <div className="paper-grain" aria-hidden="true" />

      <header className="landing-header">
        <Link className="brand-lockup" href="/" aria-label="推し輪 ホーム">
          <span className="brand-mark" aria-hidden="true">
            推
          </span>
          <h1>推し輪</h1>
          <span className="brand-ruby">OSHIWA</span>
        </Link>
        <span className="privacy-pill">
          <LockKeyhole size={15} strokeWidth={2.4} aria-hidden="true" />
          招待制
        </span>
      </header>

      <main>
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow" lang="en">
              <Sparkles size={16} aria-hidden="true" />
              PRIVATE FAN COMMUNITY
            </p>
            <h2 id="hero-title">好きな気持ちを、身内だけで。</h2>
            <p className="hero-lead">
              推しの写真も、尊かった瞬間も、いつものメンバーと安心して共有。
              <span>招待された方のみ参加できます。</span>
            </p>

            <div className="hero-actions">
              <Link className="button button-primary" href="/login">
                メールでログイン
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="button button-secondary" href="/join">
                招待を受け取った方
              </Link>
            </div>

            <ul className="trust-list" aria-label="推し輪の特徴">
              <li>
                <LockKeyhole size={16} aria-hidden="true" />
                グループ外は閲覧不可
              </li>
              <li>
                <Users size={16} aria-hidden="true" />
                身内だけで無料
              </li>
            </ul>
          </div>

          <div
            className="preview-stage"
            role="img"
            aria-label="推し輪のタイムライン画面イメージ"
          >
            <div className="spark spark-one" aria-hidden="true">
              ✦
            </div>
            <div className="spark spark-two" aria-hidden="true">
              ✶
            </div>
            <article className="phone-preview">
              <div className="preview-topbar">
                <div>
                  <span className="preview-kicker">きょうの推し輪</span>
                  <strong>みんなのタイムライン</strong>
                </div>
                <span className="member-stack">
                  <i>ゆ</i>
                  <i>な</i>
                  <i>＋2</i>
                </span>
              </div>

              <div className="oshi-strip">
                <div className="oshi-chip is-active">
                  <span className="oshi-avatar avatar-coral">凛</span>
                  <span>凛ちゃん</span>
                </div>
                <div className="oshi-chip">
                  <span className="oshi-avatar avatar-lime">翔</span>
                  <span>翔くん</span>
                </div>
                <div className="oshi-chip">
                  <span className="oshi-avatar avatar-sky">M</span>
                  <span>MIO</span>
                </div>
              </div>

              <div className="feed-card">
                <div className="post-author">
                  <span className="user-avatar">ゆ</span>
                  <div>
                    <strong>ゆい</strong>
                    <span>3分前 · 凛ちゃん</span>
                  </div>
                  <span className="post-badge">NEW</span>
                </div>
                <div className="photo-placeholder">
                  <div className="photo-orbit orbit-one" />
                  <div className="photo-orbit orbit-two" />
                  <span className="photo-star">推</span>
                  <p>今日も最高だった！</p>
                </div>
                <p className="post-copy">
                  ライブの余韻がすごい…またみんなで行こうね
                </p>
                <div className="hashtag-row">
                  <span>#今日の推し</span>
                  <span>#尊い</span>
                </div>
                <div className="reaction-row">
                  <span className="reaction is-liked">
                    <Heart size={17} fill="currentColor" aria-hidden="true" />
                    12
                  </span>
                  <span className="reaction">
                    <MessageCircle size={17} aria-hidden="true" />3
                  </span>
                  <span className="reaction-note">ななさんほかがいいね</span>
                </div>
              </div>

              <div className="mobile-preview-nav">
                {navItems.map(({ icon: Icon, label, active }) => (
                  <span className={active ? "is-active" : ""} key={label}>
                    <Icon size={19} strokeWidth={active ? 2.6 : 2} aria-hidden="true" />
                    {label}
                  </span>
                ))}
              </div>
            </article>

            <div className="floating-note note-like" aria-hidden="true">
              <Heart size={18} fill="currentColor" />
              いいね！
            </div>
            <div className="floating-note note-private" aria-hidden="true">
              <LockKeyhole size={17} />
              この輪だけ
            </div>
          </div>
        </section>

        <section className="feature-section" aria-labelledby="features-title">
          <div className="section-heading">
            <p lang="en">SMALL CIRCLE, BIG LOVE</p>
            <h2 id="features-title">推し活の「残したい」が、ぜんぶここに。</h2>
          </div>
          <div className="feature-grid">
            {featureItems.map(({ icon: Icon, title, text, tone }, index) => (
              <article className={`feature-card tone-${tone}`} key={title}>
                <span className="feature-number" aria-hidden="true">
                  0{index + 1}
                </span>
                <span className="feature-icon">
                  <Icon size={25} strokeWidth={2.2} aria-hidden="true" />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span className="footer-mark" aria-hidden="true">
          推
        </span>
        <p>
          推し輪 <span>— 好きを安心して持ち寄れる場所</span>
        </p>
      </footer>

    </div>
  );
}
