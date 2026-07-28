import Link from "next/link";

import { PostDeleteForm } from "@/app/components/posts/PostDeleteForm";
import { PostEditForm } from "@/app/components/posts/PostEditForm";
import { PostImageManager } from "@/app/components/posts/PostImageManager";
import type { PostAction } from "@/app/groups/[groupId]/posts/actions";
import { memberColorClassName } from "@/lib/oshis/member-color";
import { formatPostTimestamp } from "@/lib/posts/format";
import type { TimelineEntry, TimelineOshi } from "@/lib/posts/timeline";
import { timelineHref } from "@/lib/posts/timeline-links";

export type PostCardActions = {
  attach: PostAction;
  detach: PostAction;
  remove: PostAction;
  update: PostAction;
};

export function PostCard({
  actions,
  basePath,
  entry,
  groupId,
  oshis,
}: {
  actions: PostCardActions;
  basePath: string;
  entry: TimelineEntry;
  groupId: string;
  oshis: readonly TimelineOshi[];
}) {
  return (
    <article className="post-card" aria-labelledby={`post-author-${entry.id}`}>
      <header className="post-card-header">
        <span className="post-author" id={`post-author-${entry.id}`}>
          {entry.authorName}
        </span>
        <time className="post-time" dateTime={entry.createdAt}>
          {formatPostTimestamp(entry.createdAt)}
        </time>
        {entry.edited ? <span className="post-edited">編集済み</span> : null}
      </header>

      {/* The line breaks the member typed are part of what they wrote, so they
          are preserved by the stylesheet rather than collapsed. */}
      <p className="post-body">{entry.body}</p>

      {entry.images.length > 0 ? (
        <ul className="post-images" aria-label="この投稿の写真">
          {entry.images.map((image, index) =>
            image.imageUrl ? (
              <li key={image.imagePath}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={`${entry.authorName}の投稿の写真${index + 1}枚目`}
                  className="post-photo"
                  decoding="async"
                  loading="lazy"
                  src={image.imageUrl}
                />
              </li>
            ) : (
              <li key={image.imagePath}>
                <p className="post-photo-empty">
                  写真を読み込めませんでした。
                </p>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {entry.oshis.length > 0 ? (
        <ul className="post-oshi-list" aria-label="関連する推し">
          {entry.oshis.map((oshi) => (
            <li key={oshi.id}>
              <Link
                className={`post-oshi-chip ${memberColorClassName(oshi.color)}`}
                href={timelineHref(basePath, { oshi: oshi.id })}
              >
                {oshi.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {entry.hashtags.length > 0 ? (
        <ul className="post-hashtag-list" aria-label="ハッシュタグ">
          {entry.hashtags.map((tag) => (
            <li key={tag}>
              <Link
                className="post-hashtag"
                href={timelineHref(basePath, { tag })}
              >
                {`#${tag}`}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {entry.canEdit || entry.canRemove ? (
        <details className="post-manage-panel">
          <summary>この投稿を管理</summary>
          {entry.canEdit ? (
            <>
              <PostEditForm
                action={actions.update}
                entry={entry}
                groupId={groupId}
                oshis={oshis}
              />
              <PostImageManager
                attachAction={actions.attach}
                detachAction={actions.detach}
                entry={entry}
                groupId={groupId}
              />
            </>
          ) : null}
          {entry.canRemove ? (
            <PostDeleteForm
              action={actions.remove}
              authorName={entry.authorName}
              groupId={groupId}
              postId={entry.id}
            />
          ) : null}
        </details>
      ) : null}
    </article>
  );
}
