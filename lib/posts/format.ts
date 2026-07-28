/**
 * Both the server render and the browser hydration have to produce the same
 * characters, so neither the locale nor the zone may come from the runtime.
 * Pinning them to the audience's own zone is also what makes "22:15" mean the
 * time the member remembers being at the venue.
 */
const TIMELINE_TIME_ZONE = "Asia/Tokyo";

const timestampFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TIMELINE_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatPostTimestamp(value: string): string {
  const parsed = Date.parse(value);

  // A row the database could not have written still has to render as
  // something a reader can look at.
  return Number.isNaN(parsed) ? value : timestampFormat.format(parsed);
}
