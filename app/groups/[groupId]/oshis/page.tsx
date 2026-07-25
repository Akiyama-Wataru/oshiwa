import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { LogoutButton } from "@/app/components/auth/LogoutButton";
import { OshiBoard } from "@/app/components/oshis/OshiBoard";
import { OshiCreateForm } from "@/app/components/oshis/OshiCreateForm";
import {
  createOshiAction,
  deleteOshiAction,
  reorderOshisAction,
  updateOshiAction,
  uploadOshiImageAction,
} from "@/app/groups/[groupId]/oshis/actions";
import { logoutAction } from "@/app/groups/actions";
import { SupabaseConfigurationError } from "@/lib/env";
import {
  type OshiBoardEntry,
  applySignedUrls,
  collectImagePaths,
  normalizeOshiRows,
} from "@/lib/oshis/oshi-board";
import { OSHI_IMAGE_BUCKET } from "@/lib/oshis/storage";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { oshiGroupIdSchema } from "@/lib/validation/oshis";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "推し | 推し輪",
  robots: { index: false, follow: false },
};

/** Long enough to render the page, short enough to make a leaked URL useless. */
const SIGNED_URL_TTL_SECONDS = 300;

type MembershipRole = "owner" | "admin" | "member";

type Board = {
  groupName: string;
  role: MembershipRole;
  entries: OshiBoardEntry[];
  entriesFailed: boolean;
};

/** Distinguishes "this group is not yours" from "the database is unwell". */
class BoardUnavailableError extends Error {}

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

async function loadBoard(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<Board | null> {
  const { data: membershipRow, error: membershipError } = await supabase
    .from("memberships")
    .select("role, groups(name)")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  // A failed lookup must not be reported as "no such group": that would tell a
  // member their own circle had disappeared.
  if (membershipError) {
    throw new BoardUnavailableError("membership lookup failed");
  }

  const membership = readMembership(membershipRow);

  if (!membership) {
    return null;
  }

  const isManager = membership.role !== "member";
  const { data: oshiRows, error: oshiError } = await supabase
    .from("oshis")
    .select("id, name, member_color, image_path, created_by")
    .eq("group_id", groupId)
    .order("sort_order", { ascending: true });

  if (oshiError) {
    return { ...membership, entries: [], entriesFailed: true };
  }

  const entries = normalizeOshiRows(oshiRows, { userId, isManager });
  const imagePaths = collectImagePaths(entries);

  if (imagePaths.length === 0) {
    return { ...membership, entries, entriesFailed: false };
  }

  const { data: signed } = await supabase.storage
    .from(OSHI_IMAGE_BUCKET)
    .createSignedUrls(imagePaths, SIGNED_URL_TTL_SECONDS);

  return {
    ...membership,
    entries: applySignedUrls(entries, signed),
    entriesFailed: false,
  };
}

export default async function OshisPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const parsedGroupId = oshiGroupIdSchema.safeParse(groupId);

  if (!parsedGroupId.success) {
    notFound();
  }

  let board: Board | null;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      redirect(
        `/login?returnTo=${encodeURIComponent(`/groups/${parsedGroupId.data}/oshis`)}`,
      );
    }

    board = await loadBoard(supabase, parsedGroupId.data, user.id);
  } catch (caught) {
    if (
      caught instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return (
        <main className="auth-shell">
          <section className="auth-card" aria-labelledby="oshis-title">
            <AuthBrand />
            <div className="auth-heading">
              <p className="eyebrow" lang="en">
                LOCAL PREVIEW
              </p>
              <h1 id="oshis-title">認証接続が未設定です</h1>
              <p>Supabaseを設定すると、グループの推しを管理できます。</p>
            </div>
          </section>
        </main>
      );
    }

    if (caught instanceof BoardUnavailableError) {
      return (
        <main className="auth-shell">
          <section className="auth-card" aria-labelledby="oshis-title">
            <AuthBrand />
            <div className="auth-heading">
              <h1 id="oshis-title">推しを読み込めませんでした</h1>
              <p>時間をおいて再読み込みしてください。</p>
            </div>
          </section>
        </main>
      );
    }

    throw caught;
  }

  if (!board) {
    notFound();
  }

  return (
    <main className="auth-shell">
      <section
        className="auth-card groups-card groups-dashboard"
        aria-labelledby="oshis-title"
      >
        <div className="groups-topbar">
          <AuthBrand />
          <LogoutButton action={logoutAction} />
        </div>

        <div className="groups-intro">
          <div className="auth-heading">
            <p className="eyebrow" lang="en">
              YOUR OSHIS
            </p>
            <h1 id="oshis-title">{`${board.groupName}の推し`}</h1>
            <p>
              推しごとに色を決めると、投稿やタイムラインでひと目で見分けられます。
            </p>
            <Link className="oshi-back-link" href="/groups">
              参加中の輪へ戻る
            </Link>
          </div>

          <aside className="group-create-panel" aria-labelledby="add-oshi-title">
            <p className="eyebrow" lang="en">
              NEW OSHI
            </p>
            <h2 id="add-oshi-title">推しを追加する</h2>
            <OshiCreateForm action={createOshiAction} groupId={parsedGroupId.data} />
          </aside>
        </div>

        {board.entriesFailed ? (
          <p className="auth-status is-error" role="alert">
            推しを読み込めませんでした。時間をおいて再読み込みしてください。
          </p>
        ) : (
          <OshiBoard
            canReorder={board.role !== "member"}
            deleteAction={deleteOshiAction}
            entries={board.entries}
            groupId={parsedGroupId.data}
            reorderAction={reorderOshisAction}
            updateAction={updateOshiAction}
            uploadAction={uploadOshiImageAction}
          />
        )}
      </section>
    </main>
  );
}
