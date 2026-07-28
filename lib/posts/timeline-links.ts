export type TimelineQuery = {
  oshi?: string | null;
  tag?: string | null;
  before?: string | null;
};

/**
 * Every link out of the timeline keeps the filters the reader chose. Building
 * them in one place is what stops "older posts" from quietly dropping the
 * filter and showing a different timeline than the one on screen.
 */
export function timelineHref(basePath: string, query: TimelineQuery): string {
  const params = new URLSearchParams();

  for (const key of ["oshi", "tag", "before"] as const) {
    const value = query[key];

    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    }
  }

  const search = params.toString();

  return search ? `${basePath}?${search}` : basePath;
}
