import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { LogoutButton } from "@/app/components/auth/LogoutButton";
import { InvitationRevokeForm } from "@/app/components/members/InvitationRevokeForm";
import { LeaveGroupForm } from "@/app/components/members/LeaveGroupForm";
import { MemberRoster } from "@/app/components/members/MemberRoster";
import { logoutAction } from "@/app/groups/actions";
import {
  changeMemberRoleAction,
  leaveGroupAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/app/groups/[groupId]/members/actions";
import { SupabaseConfigurationError } from "@/lib/env";
import {
  type MembershipRole,
  type PendingInvitation,
  type RosterMember,
  ROLE_LABELS,
  normalizeInvitationRows,
  normalizeMembershipRows,
} from "@/lib/members/roster";
import { formatPostTimestamp } from "@/lib/posts/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { memberGroupIdSchema } from "@/lib/validation/members";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "メンバー | 推し輪",
  robots: { index: false, follow: false },
};

type Roster = {
  groupName: string;
  role: MembershipRole;
  members: RosterMember[];
  invitations: PendingInvitation[];
  canLeave: boolean;
  membersFailed: boolean;
};

/** Distinguishes "this group is not yours" from "the database is unwell". */
class RosterUnavailableError extends Error {}

function readMembership(
  value: unknown,
): { role: MembershipRole; groupName: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const membership = value as Record<string, unknown>;
  const relation = Array.isArray(membership.groups)
    ? membership.groups[0]
    : membership.groups;
  const group = (relation ?? {}) as Record<string, unknown>;
  const role = membership.role;

  if (
    typeof group.name !== "string" ||
    (role !== "owner" && role !== "admin" && role !== "member")
  ) {
    return null;
  }

  return { role, groupName: group.name };
}

async function loadInvitations(
  supabase: SupabaseClient,
  groupId: string,
): Promise<PendingInvitation[]> {
  // Row level security already limits this table to managers, so a plain
  // member simply reads nothing rather than being refused.
  const { data, error } = await supabase
    .from("invitations")
    .select(
      "id, email_normalized, role, expires_at, revoked_at, accepted_at, delivery_state",
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  return error ? [] : normalizeInvitationRows(data);
}

async function loadRoster(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<Roster | null> {
  const { data: membershipRow, error: membershipError } = await supabase
    .from("memberships")
    .select("role, groups(name)")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  // A failed lookup must not be reported as "no such group": that would tell a
  // member their own circle had disappeared.
  if (membershipError) {
    throw new RosterUnavailableError("membership lookup failed");
  }

  const membership = readMembership(membershipRow);

  if (!membership) {
    return null;
  }

  const { data: memberRows, error: membersError } = await supabase
    .from("memberships")
    .select("user_id, role, profiles(display_name)")
    .eq("group_id", groupId);

  if (membersError) {
    return {
      ...membership,
      members: [],
      invitations: [],
      canLeave: false,
      membersFailed: true,
    };
  }

  const members = normalizeMembershipRows(memberRows, {
    userId,
    role: membership.role,
  });

  return {
    ...membership,
    members,
    invitations:
      membership.role === "member"
        ? []
        : await loadInvitations(supabase, groupId),
    // The last owner cannot leave, and the roster already worked that out.
    canLeave: members.some((entry) => entry.isSelf && entry.canRemove),
    membersFailed: false,
  };
}

function RosterShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="members-title">
        <AuthBrand />
        <div className="auth-heading">
          <h1 id="members-title">{title}</h1>
          {children}
        </div>
      </section>
    </main>
  );
}

export default async function MembersPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const parsedGroupId = memberGroupIdSchema.safeParse(groupId);

  if (!parsedGroupId.success) {
    notFound();
  }

  const basePath = `/groups/${parsedGroupId.data}/members`;
  let roster: Roster | null;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      redirect(`/login?returnTo=${encodeURIComponent(basePath)}`);
    }

    roster = await loadRoster(supabase, parsedGroupId.data, user.id);
  } catch (caught) {
    if (
      caught instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return (
        <RosterShell title="認証接続が未設定です">
          <p className="eyebrow" lang="en">
            LOCAL PREVIEW
          </p>
          <p>Supabaseを設定すると、メンバーを管理できます。</p>
        </RosterShell>
      );
    }

    if (caught instanceof RosterUnavailableError) {
      return (
        <RosterShell title="メンバーを読み込めませんでした">
          <p>時間をおいて再読み込みしてください。</p>
        </RosterShell>
      );
    }

    throw caught;
  }

  if (!roster) {
    notFound();
  }

  return (
    <main className="auth-shell">
      <section
        className="auth-card groups-card groups-dashboard"
        aria-labelledby="members-title"
      >
        <div className="groups-topbar">
          <AuthBrand />
          <LogoutButton action={logoutAction} />
        </div>

        <div className="groups-intro">
          <div className="auth-heading">
            <p className="eyebrow" lang="en">
              MEMBERS
            </p>
            <h1 id="members-title">{`${roster.groupName}のメンバー`}</h1>
            <p>
              {`あなたの権限は「${ROLE_LABELS[roster.role]}」です。オーナーだけが権限を変更できます。`}
            </p>
            <Link
              className="oshi-back-link"
              href={`/groups/${parsedGroupId.data}/posts`}
            >
              タイムラインへ
            </Link>
          </div>
        </div>

        {roster.membersFailed ? (
          <p className="auth-status is-error" role="alert">
            メンバーを読み込めませんでした。時間をおいて再読み込みしてください。
          </p>
        ) : (
          <MemberRoster
            groupId={parsedGroupId.data}
            members={roster.members}
            removeAction={removeMemberAction}
            roleAction={changeMemberRoleAction}
          />
        )}

        {roster.role !== "member" ? (
          <section
            className="invitation-section"
            aria-labelledby="pending-invitations-title"
          >
            <h2 className="eyebrow" id="pending-invitations-title">
              返信待ちの招待
            </h2>
            {roster.invitations.length === 0 ? (
              <p className="post-field-hint">
                返信待ちの招待はありません。招待は「参加中の輪」から送れます。
              </p>
            ) : (
              <ul className="invitation-list" aria-label="返信待ちの招待">
                {roster.invitations.map((invitation) => (
                  <li className="invitation-card" key={invitation.id}>
                    <div className="invitation-card-heading">
                      <span className={`role-badge role-${invitation.role}`}>
                        {ROLE_LABELS[invitation.role]}
                      </span>
                      <span className="invitation-email">
                        {invitation.email}
                      </span>
                    </div>
                    <p className="post-field-hint">
                      {`${formatPostTimestamp(invitation.expiresAt)}まで有効`}
                    </p>
                    {invitation.deliveryFailed ? (
                      <p className="auth-inline-status is-error">
                        メールを送信できませんでした。手動リンクを渡すか、取り消して再送してください。
                      </p>
                    ) : null}
                    <InvitationRevokeForm
                      action={revokeInvitationAction}
                      email={invitation.email}
                      groupId={parsedGroupId.data}
                      invitationId={invitation.id}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {roster.canLeave ? (
          <LeaveGroupForm
            action={leaveGroupAction}
            groupId={parsedGroupId.data}
            groupName={roster.groupName}
          />
        ) : null}
      </section>
    </main>
  );
}
