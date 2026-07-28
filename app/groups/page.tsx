import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { CreateGroupForm } from "@/app/components/auth/CreateGroupForm";
import { InviteMemberForm } from "@/app/components/auth/InviteMemberForm";
import { LogoutButton } from "@/app/components/auth/LogoutButton";
import {
  createGroupAction,
  inviteMemberAction,
  logoutAction,
} from "@/app/groups/actions";
import { SupabaseConfigurationError } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "グループ | 推し輪",
  robots: { index: false, follow: false },
};

type GroupMembership = {
  groupId: string;
  groupName: string;
  role: "owner" | "admin" | "member";
};

const roleLabels: Record<GroupMembership["role"], string> = {
  owner: "オーナー",
  admin: "管理者",
  member: "メンバー",
};

function normalizeMemberships(value: unknown): GroupMembership[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }

    const membership = row as Record<string, unknown>;
    const relation = Array.isArray(membership.groups)
      ? membership.groups[0]
      : membership.groups;

    if (!relation || typeof relation !== "object") {
      return [];
    }

    const group = relation as Record<string, unknown>;
    const role = membership.role;

    if (
      typeof group.id !== "string" ||
      typeof group.name !== "string" ||
      (role !== "owner" && role !== "admin" && role !== "member")
    ) {
      return [];
    }

    return [
      {
        groupId: group.id,
        groupName: group.name,
        role,
      },
    ];
  });
}

export default async function GroupsPage({
  searchParams,
}: {
  searchParams?: Promise<{ created?: string | string[] }>;
} = {}) {
  const query = (await searchParams) ?? {};
  let memberships: GroupMembership[] = [];
  let membershipLoadFailed = false;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      redirect("/login?returnTo=%2Fgroups");
    }

    const { data, error } = await supabase
      .from("memberships")
      .select("group_id, role, groups(id, name)");

    if (error) {
      membershipLoadFailed = true;
    } else {
      memberships = normalizeMemberships(data);
    }
  } catch (error) {
    if (
      error instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return (
        <main className="auth-shell">
          <section className="auth-card" aria-labelledby="groups-title">
            <AuthBrand />
            <div className="auth-heading">
              <p className="eyebrow" lang="en">
                LOCAL PREVIEW
              </p>
              <h1 id="groups-title">認証接続が未設定です</h1>
              <p>Supabaseを設定すると、参加中のグループを確認できます。</p>
            </div>
          </section>
        </main>
      );
    }

    throw error;
  }

  return (
    <main className="auth-shell">
      <section
        className="auth-card groups-card groups-dashboard"
        aria-labelledby="groups-title"
      >
        <div className="groups-topbar">
          <AuthBrand />
          <LogoutButton action={logoutAction} />
        </div>

        <div className="groups-intro">
          <div className="auth-heading">
            <p className="eyebrow" lang="en">
              YOUR CIRCLES
            </p>
            <h1 id="groups-title">参加中の輪</h1>
            <p>グループを選んで、みんなの推し活を見にいきましょう。</p>
          </div>

          <aside className="group-create-panel" aria-labelledby="create-title">
            <p className="eyebrow" lang="en">
              NEW CIRCLE
            </p>
            <h2 id="create-title">新しい輪をつくる</h2>
            <CreateGroupForm action={createGroupAction} />
          </aside>
        </div>

        {query.created === "1" ? (
          <p className="groups-notice" role="status">
            グループを作成しました。
          </p>
        ) : null}

        {membershipLoadFailed ? (
          <p className="auth-status is-error" role="alert">
            グループを読み込めませんでした。時間をおいて再読み込みしてください。
          </p>
        ) : memberships.length === 0 ? (
          <div className="groups-empty">
            <span aria-hidden="true">✦</span>
            <p>
              <strong>まだグループに参加していません。</strong>
              新しい輪を作るか、管理者から届いた招待リンクを開いてください。
            </p>
          </div>
        ) : (
          <ul className="groups-grid" aria-label="参加中のグループ">
            {memberships.map((membership) => {
              const canInvite =
                membership.role === "owner" || membership.role === "admin";

              return (
                <li className="group-membership-card" key={membership.groupId}>
                  <div className="group-card-heading">
                    <span className={`role-badge role-${membership.role}`}>
                      {roleLabels[membership.role]}
                    </span>
                    <h2>{membership.groupName}</h2>
                  </div>
                  <p className="group-card-copy">
                    この輪の投稿や推しは、参加メンバーだけに公開されます。
                  </p>
                  <Link
                    className="group-card-link"
                    href={`/groups/${membership.groupId}/posts`}
                  >
                    {`${membership.groupName}のタイムラインを見る`}
                  </Link>
                  <Link
                    className="group-card-link"
                    href={`/groups/${membership.groupId}/oshis`}
                  >
                    {`${membership.groupName}の推しを見る`}
                  </Link>
                  <Link
                    className="group-card-link"
                    href={`/groups/${membership.groupId}/members`}
                  >
                    {`${membership.groupName}のメンバーを見る`}
                  </Link>
                  {canInvite ? (
                    <details className="group-invite-panel">
                      <summary>メンバーを招待</summary>
                      <InviteMemberForm
                        action={inviteMemberAction}
                        groupId={membership.groupId}
                        groupName={membership.groupName}
                      />
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
