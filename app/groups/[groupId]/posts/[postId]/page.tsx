import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AuthBrand } from "@/app/components/auth/AuthBrand";
import { LogoutButton } from "@/app/components/auth/LogoutButton";
import { PostCard } from "@/app/components/posts/PostCard";
import { logoutAction } from "@/app/groups/actions";
import {
  attachPostImageAction,
  deletePostAction,
  detachPostImageAction,
  updatePostAction,
} from "@/app/groups/[groupId]/posts/actions";
import {
  createReplyAction,
  deleteReplyAction,
  sharePostAction,
  togglePostLikeAction,
  unsharePostAction,
} from "@/app/groups/[groupId]/posts/reactions";
import { SupabaseConfigurationError } from "@/lib/env";
import { POST_IMAGE_BUCKET } from "@/lib/posts/storage";
import {
  type TimelineEntry,
  type TimelineOshi,
  applyTimelineSignedUrls,
  collectTimelineImagePaths,
  normalizeTimelineRows,
} from "@/lib/posts/timeline";
import {
  type TimelineMembershipRole,
  loadTimelineOshis,
  readTimelineMembership,
} from "@/lib/posts/timeline-context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { postGroupIdSchema, postIdSchema } from "@/lib/validation/posts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "投稿 | 推し輪",
  robots: { index: false, follow: false },
};

/** Long enough to render the page, short enough to make a leaked URL useless. */
const SIGNED_URL_TTL_SECONDS = 300;

type PostThread = {
  groupName: string;
  role: TimelineMembershipRole;
  entry: TimelineEntry;
  oshis: TimelineOshi[];
};

/** Distinguishes "this post is not yours to read" from "the database is unwell". */
class ThreadUnavailableError extends Error {}

async function loadThread(
  supabase: SupabaseClient,
  groupId: string,
  postId: string,
  userId: string,
): Promise<PostThread | null> {
  const { data: membershipRow, error: membershipError } = await supabase
    .from("memberships")
    .select("role, groups(name)")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    throw new ThreadUnavailableError("membership lookup failed");
  }

  const membership = readTimelineMembership(membershipRow);

  if (!membership) {
    return null;
  }

  const { data: rows, error: postError } = await supabase.rpc(
    "get_group_post",
    { target_post_id: postId, target_group_id: groupId },
  );

  if (postError) {
    throw new ThreadUnavailableError("post lookup failed");
  }

  const [entry] = normalizeTimelineRows(rows, {
    userId,
    isManager: membership.role !== "member",
  });

  // A post in another circle, and a post that was deleted while the reader was
  // on their way here, both simply are not there.
  if (!entry) {
    return null;
  }

  const oshis = await loadTimelineOshis(supabase, groupId, userId);
  const imagePaths = collectTimelineImagePaths([entry]);

  if (imagePaths.length === 0) {
    return { ...membership, entry, oshis };
  }

  const { data: signed } = await supabase.storage
    .from(POST_IMAGE_BUCKET)
    .createSignedUrls(imagePaths, SIGNED_URL_TTL_SECONDS);

  return {
    ...membership,
    entry: applyTimelineSignedUrls([entry], signed)[0],
    oshis,
  };
}

function ThreadShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="post-title">
        <AuthBrand />
        <div className="auth-heading">
          <h1 id="post-title">{title}</h1>
          {children}
        </div>
      </section>
    </main>
  );
}

export default async function PostThreadPage({
  params,
}: {
  params: Promise<{ groupId: string; postId: string }>;
}) {
  const { groupId, postId } = await params;
  const parsedGroupId = postGroupIdSchema.safeParse(groupId);
  const parsedPostId = postIdSchema.safeParse(postId);

  if (!parsedGroupId.success || !parsedPostId.success) {
    notFound();
  }

  const basePath = `/groups/${parsedGroupId.data}/posts`;
  const threadPath = `${basePath}/${parsedPostId.data}`;
  let thread: PostThread | null;

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      redirect(`/login?returnTo=${encodeURIComponent(threadPath)}`);
    }

    thread = await loadThread(
      supabase,
      parsedGroupId.data,
      parsedPostId.data,
      user.id,
    );
  } catch (caught) {
    if (
      caught instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return (
        <ThreadShell title="認証接続が未設定です">
          <p className="eyebrow" lang="en">
            LOCAL PREVIEW
          </p>
          <p>Supabaseを設定すると、投稿と返信を表示できます。</p>
        </ThreadShell>
      );
    }

    if (caught instanceof ThreadUnavailableError) {
      return (
        <ThreadShell title="投稿を読み込めませんでした">
          <p>時間をおいて再読み込みしてください。</p>
        </ThreadShell>
      );
    }

    throw caught;
  }

  if (!thread) {
    notFound();
  }

  return (
    <main className="auth-shell">
      <section
        className="auth-card groups-card groups-dashboard"
        aria-labelledby="post-title"
      >
        <div className="groups-topbar">
          <AuthBrand />
          <LogoutButton action={logoutAction} />
        </div>

        <div className="groups-intro">
          <div className="auth-heading">
            <p className="eyebrow" lang="en">
              POST
            </p>
            <h1 id="post-title">{`${thread.groupName}の投稿`}</h1>
            <p>{`${thread.entry.authorName}の投稿と、${thread.entry.replyCount}件の返信です。`}</p>
            <Link className="oshi-back-link" href={basePath}>
              タイムラインへ
            </Link>
          </div>
        </div>

        <PostCard
          actions={{
            attach: attachPostImageAction,
            detach: detachPostImageAction,
            remove: deletePostAction,
            update: updatePostAction,
            reactions: {
              like: togglePostLikeAction,
              reply: createReplyAction,
              removeReply: deleteReplyAction,
              share: sharePostAction,
              unshare: unsharePostAction,
            },
          }}
          basePath={basePath}
          entry={thread.entry}
          groupId={parsedGroupId.data}
          oshis={thread.oshis}
        />
      </section>
    </main>
  );
}
