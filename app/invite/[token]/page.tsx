import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AcceptJoinLinkForm } from "@/app/components/auth/AcceptJoinLinkForm";
import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { acceptJoinLinkAction } from "@/app/invite/[token]/actions";
import { SupabaseConfigurationError } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { joinLinkTokenSchema } from "@/lib/validation/join-links";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "参加リンク | 推し輪",
  robots: { index: false, follow: false },
};

function InviteShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="invite-title">
        <AuthBrand />
        <div className="auth-heading">
          <p className="eyebrow" lang="en">
            JOIN A CIRCLE
          </p>
          <h1 id="invite-title">{title}</h1>
          {children}
        </div>
      </section>
    </main>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const parsedToken = joinLinkTokenSchema.safeParse(token);

  if (!parsedToken.success) {
    notFound();
  }

  const continuePath = `/invite/${parsedToken.data}`;
  let signedIn = false;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    signedIn = Boolean(user);
  } catch (caught) {
    if (
      caught instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return (
        <InviteShell title="認証接続が未設定です">
          <p className="eyebrow" lang="en">
            LOCAL PREVIEW
          </p>
          <p>Supabaseを設定すると、参加リンクを受け取れます。</p>
        </InviteShell>
      );
    }

    throw caught;
  }

  // The circle is never named before somebody is in it. Whoever holds this URL
  // has not been let in yet, and the name of a private circle is already
  // something only its members should know.
  if (!signedIn) {
    return (
      <InviteShell title="参加リンクを受け取りました">
        <p>
          この輪に参加するには、ログインするかアカウントを作ってください。そのあとこの画面に戻ります。
        </p>
        <Link
          className="button button-primary"
          href={`/login?returnTo=${encodeURIComponent(continuePath)}`}
        >
          ログインして参加
        </Link>
        <Link
          className="auth-text-link"
          href={`/signup?returnTo=${encodeURIComponent(continuePath)}`}
        >
          はじめての方はアカウントを作る
        </Link>
      </InviteShell>
    );
  }

  return (
    <InviteShell title="参加リンクを受け取りました">
      <p>
        このリンクは一度きりです。参加するとリンクは無効になり、ほかの人は使えません。
      </p>
      <AcceptJoinLinkForm
        action={acceptJoinLinkAction}
        token={parsedToken.data}
      />
      <Link className="auth-text-link" href="/groups">
        参加せずに戻る
      </Link>
    </InviteShell>
  );
}
