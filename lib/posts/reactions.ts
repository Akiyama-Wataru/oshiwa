import { lowercaseUuid } from "@/lib/validation/identifiers";
import { UNSAFE_BODY_CHARACTER_PATTERN } from "@/lib/validation/text";

/** Shown when the reader cannot resolve somebody's profile row. */
export const UNKNOWN_MEMBER_NAME = "メンバー";

export type ReactionViewer = {
  userId: string;
  isManager: boolean;
};

export type TimelineReply = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  canRemove: boolean;
};

export type TimelineShare = {
  id: string;
  note: string | null;
  createdAt: string;
  sharerId: string;
  sharerName: string;
  isViewer: boolean;
};

const identifier = lowercaseUuid("有効な識別子ではありません。");

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readIdentifier(value: unknown): string | null {
  const parsed = identifier.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readTimestamp(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function readMemberName(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : UNKNOWN_MEMBER_NAME;
}

/**
 * A count arrives from a bigint column, which PostgREST may serialise either as
 * a number or as a string. Anything else counts as none: rendering NaN beside a
 * post would look like a fault in the post rather than in the row.
 */
export function readReactionCount(value: unknown): number {
  const count = typeof value === "string" ? Number(value) : value;

  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? count
    : 0;
}

export function readReactionFlag(value: unknown): boolean {
  return value === true;
}

/**
 * Replies arrive as the embedded list the read function built. The rule for
 * removing one mirrors private.can_remove_reply: the member who wrote it, or
 * somebody who moderates the circle. The database refuses anything else, and a
 * button that leads to a refusal reads as a broken app.
 */
export function normalizeReplies(
  value: unknown,
  viewer: ReactionViewer,
): TimelineReply[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    const reply = readRecord(candidate);

    if (!reply) {
      return [];
    }

    const id = readIdentifier(reply.id);
    const authorId = readIdentifier(reply.author_id);
    const createdAt = readTimestamp(reply.created_at);

    if (!id || !authorId || !createdAt || typeof reply.body !== "string") {
      return [];
    }

    return [
      {
        id,
        body: reply.body,
        createdAt,
        authorId,
        authorName: readMemberName(reply.author_name),
        canRemove: authorId === viewer.userId || viewer.isManager,
      },
    ];
  });
}

export function normalizeShares(
  value: unknown,
  viewer: ReactionViewer,
): TimelineShare[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    const share = readRecord(candidate);

    if (!share) {
      return [];
    }

    const id = readIdentifier(share.id);
    const sharerId = readIdentifier(share.sharer_id);
    const createdAt = readTimestamp(share.created_at);

    if (!id || !sharerId || !createdAt) {
      return [];
    }

    // A note that cannot be rendered costs the share its note, never its place:
    // who passed the post on is the part that matters.
    const note =
      typeof share.note === "string" &&
      share.note.length > 0 &&
      !UNSAFE_BODY_CHARACTER_PATTERN.test(share.note)
        ? share.note
        : null;

    return [
      {
        id,
        note,
        createdAt,
        sharerId,
        sharerName: readMemberName(share.sharer_name),
        isViewer: sharerId === viewer.userId,
      },
    ];
  });
}
