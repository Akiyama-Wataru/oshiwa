import Link from "next/link";

import {
  type PostCardActions,
  PostCard,
} from "@/app/components/posts/PostCard";
import type { TimelineEntry, TimelineOshi } from "@/lib/posts/timeline";
import { timelineHref } from "@/lib/posts/timeline-links";

export function PostTimeline({
  actions,
  activeOshiId,
  activeTag,
  basePath,
  entries,
  groupId,
  isFilteredPage,
  nextCursor,
  oshis,
}: {
  actions: PostCardActions;
  activeOshiId: string | null;
  activeTag: string | null;
  basePath: string;
  entries: readonly TimelineEntry[];
  groupId: string;
  isFilteredPage: boolean;
  nextCursor: string | null;
  oshis: readonly TimelineOshi[];
}) {
  if (entries.length === 0) {
    return (
      <div className="groups-empty">
        <span aria-hidden="true">✦</span>
        <p>
          <strong>
            {isFilteredPage
              ? "この条件に合う投稿はありません。"
              : "まだ投稿がありません。"}
          </strong>
          {isFilteredPage
            ? "絞り込みを変えると、ほかの投稿が見つかるかもしれません。"
            : "最初のひとことを書くと、輪のみんなに届きます。"}
        </p>
        {isFilteredPage ? (
          <Link className="oshi-back-link" href={basePath}>
            絞り込みを解除
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="post-timeline">
      <ul className="post-list" aria-label="タイムライン">
        {entries.map((entry) => (
          <li key={entry.id}>
            <PostCard
              actions={actions}
              basePath={basePath}
              entry={entry}
              groupId={groupId}
              oshis={oshis}
            />
          </li>
        ))}
      </ul>

      {nextCursor ? (
        <Link
          className="post-more-link"
          href={timelineHref(basePath, {
            oshi: activeOshiId,
            tag: activeTag,
            before: nextCursor,
          })}
        >
          古い投稿を見る
        </Link>
      ) : null}
    </div>
  );
}
