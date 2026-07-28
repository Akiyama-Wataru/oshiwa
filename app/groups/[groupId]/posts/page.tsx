import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { LogoutButton } from "@/app/components/auth/LogoutButton";
import { PostComposer } from "@/app/components/posts/PostComposer";
import { PostTimeline } from "@/app/components/posts/PostTimeline";
import { TimelineFilters } from "@/app/components/posts/TimelineFilters";
import { logoutAction } from "@/app/groups/actions";
import {
  attachPostImageAction,
  createPostAction,
  deletePostAction,
  detachPostImageAction,
  updatePostAction,
} from "@/app/groups/[groupId]/posts/actions";
import { SupabaseConfigurationError } from "@/lib/env";
import { POST_IMAGE_BUCKET } from "@/lib/posts/storage";
import {
  type TimelineCursor,
  type TimelineEntry,
  type TimelineOshi,
  TIMELINE_PAGE_SIZE,
  applyTimelineSignedUrls,
  collectTimelineImagePaths,
  decodeTimelineCursor,
  normalizeTimelineRows,
  nextTimelineCursor,
} from "@/lib/posts/timeline";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeOshiRows } from "@/lib/oshis/oshi-board";
import {
  hashtagSchema,
  postGroupIdSchema,
  postOshiIdSchema,
} from "@/lib/validation/posts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "タイムライン | 推し輪",
  robots: { index: false, follow: false },
};

/** Long enough to render the page, short enough to make a leaked URL useless. */
const SIGNED_URL_TTL_SECONDS = 300;

type MembershipRole = "owner" | "admin" | "member";

type Timeline = {
  groupName: string;
  role: MembershipRole;
  entries: TimelineEntry[];
  oshis: TimelineOshi[];
  nextCursor: string | null;
  entriesFailed: boolean;
};

/** Distinguishes "this group is not yours" from "the database is unwell". */
class TimelineUnavailableError extends Error {}

type TimelineSearch = {
  oshiId: string | null;
  tag: string | null;
  cursor: TimelineCursor | null;
};

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

/**
 * A filter that cannot be parsed is dropped rather than passed on: a rejected
 * query string should show the plain timeline, not an error page.
 */
function readSearch(params: Record<string, string | string[] | undefined>): TimelineSearch {
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const oshi = postOshiIdSchema.safeParse(single(params.oshi));
  const tag = hashtagSchema.safeParse(single(params.tag));

  return {
    oshiId: oshi.success ? oshi.data : null,
    tag: tag.success ? tag.data : null,
    // A cursor that does not decode is no cursor: the reader gets the newest
    // page rather than an empty one that claims a filter is to blame.
    cursor: decodeTimelineCursor(single(params.before)),
  };
}

async function loadOshis(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<TimelineOshi[]> {
  const { data, error } = await supabase
    .from("oshis")
    .select("id, name, member_color, image_path, created_by")
    .eq("group_id", groupId)
    .order("sort_order", { ascending: true });

  if (error) {
    return [];
  }

  return normalizeOshiRows(data, { userId, isManager: false }).map((oshi) => ({
    id: oshi.id,
    name: oshi.name,
    color: oshi.color,
  }));
}

async function loadTimeline(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
  search: TimelineSearch,
): Promise<Timeline | null> {
  const { data: membershipRow, error: membershipError } = await supabase
    .from("memberships")
    .select("role, groups(name)")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  // A failed lookup must not be reported as "no such group": that would tell a
  // member their own circle had disappeared.
  if (membershipError) {
    throw new TimelineUnavailableError("membership lookup failed");
  }

  const membership = readMembership(membershipRow);

  if (!membership) {
    return null;
  }

  const oshis = await loadOshis(supabase, groupId, userId);
  const { data: postRows, error: postsError } = await supabase.rpc(
    "list_group_posts",
    {
      target_group_id: groupId,
      filter_oshi_id: search.oshiId,
      filter_tag: search.tag,
      before_created_at: search.cursor?.createdAt ?? null,
      before_id: search.cursor?.id ?? null,
      page_size: TIMELINE_PAGE_SIZE,
    },
  );

  if (postsError) {
    return {
      ...membership,
      entries: [],
      oshis,
      nextCursor: null,
      entriesFailed: true,
    };
  }

  const entries = normalizeTimelineRows(postRows, {
    userId,
    isManager: membership.role !== "member",
  });
  const nextCursor = nextTimelineCursor(entries, TIMELINE_PAGE_SIZE);
  const imagePaths = collectTimelineImagePaths(entries);

  if (imagePaths.length === 0) {
    return { ...membership, entries, oshis, nextCursor, entriesFailed: false };
  }

  const { data: signed } = await supabase.storage
    .from(POST_IMAGE_BUCKET)
    .createSignedUrls(imagePaths, SIGNED_URL_TTL_SECONDS);

  return {
    ...membership,
    entries: applyTimelineSignedUrls(entries, signed),
    oshis,
    nextCursor,
    entriesFailed: false,
  };
}

function TimelineShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="timeline-title">
        <AuthBrand />
        <div className="auth-heading">
          <h1 id="timeline-title">{title}</h1>
          {children}
        </div>
      </section>
    </main>
  );
}

export default async function PostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { groupId } = await params;
  const parsedGroupId = postGroupIdSchema.safeParse(groupId);

  if (!parsedGroupId.success) {
    notFound();
  }

  const search = readSearch(await searchParams);
  const basePath = `/groups/${parsedGroupId.data}/posts`;
  let timeline: Timeline | null;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      redirect(`/login?returnTo=${encodeURIComponent(basePath)}`);
    }

    timeline = await loadTimeline(
      supabase,
      parsedGroupId.data,
      user.id,
      search,
    );
  } catch (caught) {
    if (
      caught instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return (
        <TimelineShell title="認証接続が未設定です">
          <p className="eyebrow" lang="en">
            LOCAL PREVIEW
          </p>
          <p>Supabaseを設定すると、グループのタイムラインを表示できます。</p>
        </TimelineShell>
      );
    }

    if (caught instanceof TimelineUnavailableError) {
      return (
        <TimelineShell title="タイムラインを読み込めませんでした">
          <p>時間をおいて再読み込みしてください。</p>
        </TimelineShell>
      );
    }

    throw caught;
  }

  if (!timeline) {
    notFound();
  }

  const isFilteredPage = Boolean(search.oshiId || search.tag || search.cursor);

  return (
    <main className="auth-shell">
      <section
        className="auth-card groups-card groups-dashboard"
        aria-labelledby="timeline-title"
      >
        <div className="groups-topbar">
          <AuthBrand />
          <LogoutButton action={logoutAction} />
        </div>

        <div className="groups-intro">
          <div className="auth-heading">
            <p className="eyebrow" lang="en">
              TIMELINE
            </p>
            <h1 id="timeline-title">{`${timeline.groupName}のタイムライン`}</h1>
            <p>同じ輪のメンバーだけが読める、今日の推しごとの記録です。</p>
            <Link
              className="oshi-back-link"
              href={`/groups/${parsedGroupId.data}/oshis`}
            >
              推しの管理へ
            </Link>
          </div>

          <aside className="group-create-panel" aria-labelledby="compose-title">
            <p className="eyebrow" lang="en">
              NEW POST
            </p>
            <h2 id="compose-title">投稿する</h2>
            <PostComposer
              action={createPostAction}
              groupId={parsedGroupId.data}
              oshis={timeline.oshis}
            />
          </aside>
        </div>

        <TimelineFilters
          activeOshiId={search.oshiId}
          activeTag={search.tag}
          basePath={basePath}
          oshis={timeline.oshis}
        />

        {timeline.entriesFailed ? (
          <p className="auth-status is-error" role="alert">
            タイムラインを読み込めませんでした。時間をおいて再読み込みしてください。
          </p>
        ) : (
          <PostTimeline
            actions={{
              attach: attachPostImageAction,
              detach: detachPostImageAction,
              remove: deletePostAction,
              update: updatePostAction,
            }}
            activeOshiId={search.oshiId}
            activeTag={search.tag}
            basePath={basePath}
            entries={timeline.entries}
            groupId={parsedGroupId.data}
            isFilteredPage={isFilteredPage}
            nextCursor={timeline.nextCursor}
            oshis={timeline.oshis}
          />
        )}
      </section>
    </main>
  );
}
