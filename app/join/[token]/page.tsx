import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  invitationSessionMode,
  type InvitationSessionMode,
} from "@/app/auth/invitation-session";
import { AcceptInvitationForm } from "@/app/components/auth/AcceptInvitationForm";
import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { JoinForm } from "@/app/components/auth/JoinForm";
import { joinAction } from "@/app/join/[token]/actions";
import { safeReturnTo } from "@/lib/auth/redirect";
import { SupabaseConfigurationError } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inviteTokenSchema } from "@/lib/validation/auth";

export const metadata: Metadata = {
  title: "招待を完了 | 推し輪",
  robots: { index: false, follow: false },
};

export default async function JoinInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ setup?: string | string[] }>;
}) {
  const { token } = await params;
  const parsed = inviteTokenSchema.safeParse(token);
  const query = (await searchParams) ?? {};
  const setupHint = query.setup === "1";
  let sessionMode: InvitationSessionMode | null = null;

  if (parsed.success) {
    try {
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        if (!setupHint) {
          const returnTo = safeReturnTo(`/join/${parsed.data}`, "/groups");
          redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
        }
      } else if (user.email && user.email_confirmed_at) {
        const { data: claimsData, error: claimsError } =
          await supabase.auth.getClaims();
        sessionMode = claimsError
          ? null
          : invitationSessionMode(claimsData?.claims);
      }
    } catch (error) {
      if (
        !(error instanceof SupabaseConfigurationError) ||
        process.env.NODE_ENV === "production"
      ) {
        throw error;
      }
    }
  }

  const heading = sessionMode === "setup"
    ? {
        eyebrow: "ONE LAST STEP",
        title: "招待を完了",
        description:
          "安全なパスワードを設定して、グループへ参加します。",
      }
    : {
        eyebrow: "JOIN THE CIRCLE",
        title: "この輪に参加",
        description:
          "ログイン中のアカウントで参加します。パスワードの変更はありません。",
      };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="join-token-title">
        <AuthBrand />
        <div className="auth-heading">
          <p className="eyebrow" lang="en">
            {heading.eyebrow}
          </p>
          <h1 id="join-token-title">{heading.title}</h1>
          <p>{heading.description}</p>
        </div>

        {parsed.success && sessionMode === "setup" ? (
          <JoinForm action={joinAction} token={parsed.data} />
        ) : parsed.success && sessionMode === "manual" ? (
          <AcceptInvitationForm action={joinAction} token={parsed.data} />
        ) : (
          <>
            <p className="auth-status is-error" role="alert">
              招待を確認できませんでした。管理者に再発行を依頼してください。
            </p>
            <Link className="button button-secondary auth-back" href="/join">
              招待について確認する
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
