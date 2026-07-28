import Link from "next/link";

import { memberColorClassName } from "@/lib/oshis/member-color";
import type { TimelineOshi } from "@/lib/posts/timeline";
import { timelineHref } from "@/lib/posts/timeline-links";

/**
 * A plain GET form: the filters have to work before any JavaScript has loaded,
 * and the resulting URL is what a member shares when they want to show someone
 * the same slice of the timeline.
 */
export function TimelineFilters({
  activeOshiId,
  activeTag,
  basePath,
  oshis,
}: {
  activeOshiId: string | null;
  activeTag: string | null;
  basePath: string;
  oshis: readonly TimelineOshi[];
}) {
  const isFiltered = Boolean(activeOshiId || activeTag);

  return (
    <section className="timeline-filters" aria-labelledby="timeline-filter-title">
      <h2 className="eyebrow" id="timeline-filter-title">
        絞り込み
      </h2>

      <form action={basePath} className="timeline-filter-form" method="get">
        <label className="post-field">
          推し
          <select defaultValue={activeOshiId ?? ""} name="oshi">
            <option value="">すべての推し</option>
            {oshis.map((oshi) => (
              <option key={oshi.id} value={oshi.id}>
                {oshi.name}
              </option>
            ))}
          </select>
        </label>

        <label className="post-field">
          ハッシュタグ
          <input
            defaultValue={activeTag ?? ""}
            name="tag"
            placeholder="尊い"
            type="text"
          />
        </label>

        <button className="button button-secondary" type="submit">
          絞り込む
        </button>

        {isFiltered ? (
          <Link className="timeline-filter-reset" href={basePath}>
            絞り込みを解除
          </Link>
        ) : null}
      </form>

      {oshis.length > 0 ? (
        <ul className="timeline-oshi-shortcuts" aria-label="推しで絞り込む">
          {oshis.map((oshi) => (
            <li key={oshi.id}>
              <Link
                aria-current={oshi.id === activeOshiId ? "true" : undefined}
                className={`post-oshi-chip ${memberColorClassName(oshi.color)}`}
                href={timelineHref(basePath, { oshi: oshi.id })}
              >
                {oshi.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
