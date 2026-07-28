import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { LogoutButton } from "@/app/components/auth/LogoutButton";
import { MarkAllReadForm } from "@/app/components/notifications/MarkAllReadForm";
import { logoutAction } from "@/app/groups/actions";
import { markNotificationsReadAction } from "@/app/notifications/actions";
import { SupabaseConfigurationError } from "@/lib/env";
import {
  type InboxEntry,
  describeNotification,
  normalizeNotificationRows,
} from "@/lib/notifications/inbox";
import { formatPostTimestamp } from "@/lib/posts/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "お知らせ | 推し輪",
  robots: { index: false, follow: false },
};

/** One screenful, and the same clamp the read function applies. */
const NOTIFICATION_PAGE_SIZE = 30;

function InboxShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="notifications-title">
        <AuthBrand />
        <div className="auth-heading">
          <h1 id="notifications-title">{title}</h1>
          {children}
        </div>
      </section>
    </main>
  );
}

export default async function NotificationsPage() {
  let entries: InboxEntry[];
  let failed = false;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      redirect(`/login?returnTo=${encodeURIComponent("/notifications")}`);
    }

    const { data, error: listError } = await supabase.rpc(
      "list_notifications",
      { page_size: NOTIFICATION_PAGE_SIZE },
    );

    failed = Boolean(listError);
    entries = failed ? [] : normalizeNotificationRows(data);
  } catch (caught) {
    if (
      caught instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return (
        <InboxShell title="認証接続が未設定です">
          <p className="eyebrow" lang="en">
            LOCAL PREVIEW
          </p>
          <p>Supabaseを設定すると、お知らせを表示できます。</p>
        </InboxShell>
      );
    }

    throw caught;
  }

  const unreadCount = entries.filter((entry) => entry.unread).length;

  return (
    <main className="auth-shell">
      <section
        className="auth-card groups-card groups-dashboard"
        aria-labelledby="notifications-title"
      >
        <div className="groups-topbar">
          <AuthBrand />
          <LogoutButton action={logoutAction} />
        </div>

        <div className="groups-intro">
          <div className="auth-heading">
            <p className="eyebrow" lang="en">
              NOTIFICATIONS
            </p>
            <h1 id="notifications-title">お知らせ</h1>
            <p>
              {unreadCount > 0
                ? `未読が${unreadCount}件あります。`
                : "未読のお知らせはありません。"}
            </p>
            <Link className="oshi-back-link" href="/groups">
              参加中の輪へ
            </Link>
          </div>

          {unreadCount > 0 ? (
            <MarkAllReadForm action={markNotificationsReadAction} />
          ) : null}
        </div>

        {failed ? (
          <p className="auth-status is-error" role="alert">
            お知らせを読み込めませんでした。時間をおいて再読み込みしてください。
          </p>
        ) : entries.length === 0 ? (
          <div className="groups-empty">
            <span aria-hidden="true">✦</span>
            <p>
              <strong>まだお知らせはありません。</strong>
              いいねや返信、共有があるとここに届きます。
            </p>
          </div>
        ) : (
          <ul className="notification-list" aria-label="お知らせ">
            {entries.map((entry) => (
              <li
                className={`notification-card ${entry.unread ? "is-unread" : ""}`}
                key={entry.id}
              >
                <Link className="notification-link" href={entry.href}>
                  <span className="notification-summary">
                    {describeNotification(entry)}
                  </span>
                  <span className="notification-group">{entry.groupName}</span>
                  {entry.postExcerpt ? (
                    <span className="notification-excerpt">
                      {entry.postExcerpt}
                    </span>
                  ) : null}
                  {entry.replyBody ? (
                    <span className="notification-reply">
                      {entry.replyBody}
                    </span>
                  ) : null}
                  <time className="post-time" dateTime={entry.createdAt}>
                    {formatPostTimestamp(entry.createdAt)}
                  </time>
                  {entry.unread ? (
                    <span className="notification-unread-badge">未読</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
