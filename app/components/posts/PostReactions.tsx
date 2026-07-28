import Link from "next/link";

import { PostLikeButton } from "@/app/components/posts/PostLikeButton";
import { PostReplyForm } from "@/app/components/posts/PostReplyForm";
import { PostShareForm } from "@/app/components/posts/PostShareForm";
import { ReplyDeleteForm } from "@/app/components/posts/ReplyDeleteForm";
import type { PostAction } from "@/app/groups/[groupId]/posts/actions";
import { formatPostTimestamp } from "@/lib/posts/format";
import type { TimelineEntry } from "@/lib/posts/timeline";

export type PostReactionActions = {
  like: PostAction;
  reply: PostAction;
  removeReply: PostAction;
  share: PostAction;
  unshare: PostAction;
};

export function PostReactions({
  actions,
  basePath,
  entry,
  groupId,
}: {
  actions: PostReactionActions;
  basePath: string;
  entry: TimelineEntry;
  groupId: string;
}) {
  // The card carries the newest few replies. When the thread is longer than
  // that, the rest live on the post's own page rather than being cut off with
  // nowhere to go.
  const hiddenReplies = entry.replyCount - entry.replies.length;

  return (
    <section className="post-reactions" aria-label="この投稿への反応">
      <div className="post-reaction-bar">
        <PostLikeButton
          action={actions.like}
          groupId={groupId}
          likeCount={entry.likeCount}
          liked={entry.likedByViewer}
          postId={entry.id}
        />
        <PostShareForm
          groupId={groupId}
          postId={entry.id}
          shareAction={actions.share}
          shareCount={entry.shareCount}
          sharedByViewer={entry.sharedByViewer}
          unshareAction={actions.unshare}
        />
      </div>

      {entry.shares.length > 0 ? (
        <ul className="post-share-list" aria-label="この投稿を共有したメンバー">
          {entry.shares.map((share) => (
            <li key={share.id}>
              <span className="post-share-sharer">
                {`${share.sharerName}が共有`}
              </span>
              {share.note ? (
                <span className="post-share-note">{share.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {entry.replies.length > 0 ? (
        <ol className="post-reply-list" aria-label="返信">
          {entry.replies.map((reply) => (
            <li className="post-reply" key={reply.id}>
              <div className="post-reply-heading">
                <span className="post-reply-author">{reply.authorName}</span>
                <time className="post-time" dateTime={reply.createdAt}>
                  {formatPostTimestamp(reply.createdAt)}
                </time>
              </div>
              <p className="post-reply-body">{reply.body}</p>
              {reply.canRemove ? (
                <ReplyDeleteForm
                  action={actions.removeReply}
                  authorName={reply.authorName}
                  groupId={groupId}
                  postId={entry.id}
                  replyId={reply.id}
                />
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {hiddenReplies > 0 ? (
        <Link className="post-more-link" href={`${basePath}/${entry.id}`}>
          {`返信をすべて見る（全${entry.replyCount}件）`}
        </Link>
      ) : null}

      <PostReplyForm
        action={actions.reply}
        authorName={entry.authorName}
        groupId={groupId}
        postId={entry.id}
      />
    </section>
  );
}
