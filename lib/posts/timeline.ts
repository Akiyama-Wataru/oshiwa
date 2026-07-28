import {
  type SignedObject,
  signedUrlsByPath,
} from "@/lib/media/signed-urls";
import { normalizeMemberColor } from "@/lib/oshis/member-color";
import {
  type TimelineReply,
  type TimelineShare,
  UNKNOWN_MEMBER_NAME,
  normalizeReplies,
  normalizeShares,
  readReactionCount,
  readReactionFlag,
} from "@/lib/posts/reactions";
import { lowercaseUuid } from "@/lib/validation/identifiers";
import { postImagePathSchema } from "@/lib/validation/posts";
import { UNSAFE_DISPLAY_CHARACTER_PATTERN } from "@/lib/validation/text";

/** One screenful on a phone, and well inside the function's own clamp. */
export const TIMELINE_PAGE_SIZE = 20;

export type TimelineImage = {
  imagePath: string;
  imageUrl: string | null;
};

export type TimelineOshi = {
  id: string;
  name: string;
  color: string;
};

export type TimelineEntry = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorId: string;
  authorName: string;
  edited: boolean;
  images: TimelineImage[];
  oshis: TimelineOshi[];
  hashtags: string[];
  canEdit: boolean;
  canRemove: boolean;
  likeCount: number;
  likedByViewer: boolean;
  replies: TimelineReply[];
  /** The whole thread, which can be longer than the replies carried here. */
  replyCount: number;
  shares: TimelineShare[];
  shareCount: number;
  sharedByViewer: boolean;
};

export type TimelineViewer = {
  userId: string;
  isManager: boolean;
};

export type TimelineCursor = {
  createdAt: string;
  id: string;
};

/** Applied when a row holds a colour outside the palette. */
const FALLBACK_COLOR = "#8d99ae";

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

function normalizeImages(value: unknown): TimelineImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const images = value.flatMap((candidate) => {
    const image = readRecord(candidate);

    if (
      !image ||
      typeof image.image_path !== "string" ||
      !postImagePathSchema.safeParse(image.image_path).success
    ) {
      return [];
    }

    const slot = Number(image.sort_order);

    return [
      {
        slot: Number.isFinite(slot) ? slot : Number.MAX_SAFE_INTEGER,
        image: { imagePath: image.image_path, imageUrl: null },
      },
    ];
  });

  // The function already orders by slot, but the ordering is what a reader
  // recognises as "the photos I chose", so it is re-established here rather
  // than trusted to survive serialisation.
  return images
    .sort((first, second) => first.slot - second.slot)
    .map((entry) => entry.image);
}

function normalizeOshis(value: unknown): TimelineOshi[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    const oshi = readRecord(candidate);
    const id = oshi ? readIdentifier(oshi.id) : null;

    if (!oshi || !id || typeof oshi.name !== "string") {
      return [];
    }

    return [
      {
        id,
        name: oshi.name,
        color:
          (typeof oshi.member_color === "string"
            ? normalizeMemberColor(oshi.member_color)
            : null) ?? FALLBACK_COLOR,
      },
    ];
  });
}

function normalizeHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (tag): tag is string =>
      typeof tag === "string" &&
      tag.length > 0 &&
      !UNSAFE_DISPLAY_CHARACTER_PATTERN.test(tag),
  );
}

/**
 * Rows arrive from PostgREST as unknown JSON. Anything that does not match the
 * shape the database guarantees is dropped rather than rendered, so a partially
 * migrated table can never inject an unexpected value into the markup.
 */
export function normalizeTimelineRows(
  value: unknown,
  viewer: TimelineViewer,
): TimelineEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    const post = readRecord(candidate);

    if (!post) {
      return [];
    }

    const id = readIdentifier(post.id);
    const authorId = readIdentifier(post.author_id);
    const createdAt = readTimestamp(post.created_at);

    if (!id || !authorId || !createdAt || typeof post.body !== "string") {
      return [];
    }

    const updatedAt = readTimestamp(post.updated_at) ?? createdAt;
    const canEdit = authorId === viewer.userId;

    return [
      {
        id,
        body: post.body,
        createdAt,
        updatedAt,
        authorId,
        authorName:
          typeof post.author_name === "string" && post.author_name.length > 0
            ? post.author_name
            : UNKNOWN_MEMBER_NAME,
        edited: updatedAt !== createdAt,
        images: normalizeImages(post.images),
        oshis: normalizeOshis(post.oshis),
        hashtags: normalizeHashtags(post.hashtags),
        canEdit,
        canRemove: canEdit || viewer.isManager,
        likeCount: readReactionCount(post.like_count),
        likedByViewer: readReactionFlag(post.liked_by_viewer),
        replies: normalizeReplies(post.replies, viewer),
        replyCount: readReactionCount(post.reply_count),
        shares: normalizeShares(post.shares, viewer),
        shareCount: readReactionCount(post.share_count),
        sharedByViewer: readReactionFlag(post.shared_by_viewer),
      },
    ];
  });
}

export function collectTimelineImagePaths(
  entries: readonly TimelineEntry[],
): string[] {
  return entries.flatMap((entry) =>
    entry.images.map((image) => image.imagePath),
  );
}

export function applyTimelineSignedUrls(
  entries: readonly TimelineEntry[],
  signedObjects: readonly SignedObject[] | null | undefined,
): TimelineEntry[] {
  const urlsByPath = signedUrlsByPath(signedObjects);

  return entries.map((entry) => ({
    ...entry,
    images: entry.images.map((image) => ({
      ...image,
      imageUrl: urlsByPath.get(image.imagePath) ?? null,
    })),
  }));
}

/**
 * The cursor is the sort key itself rather than an offset, so a post written
 * while the reader was paging cannot shift the next page onto rows they have
 * already seen. The separator is safe because neither half can contain it.
 */
const CURSOR_SEPARATOR = "_";

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return `${cursor.createdAt}${CURSOR_SEPARATOR}${cursor.id}`;
}

export function decodeTimelineCursor(value: unknown): TimelineCursor | null {
  if (typeof value !== "string") {
    return null;
  }

  const parts = value.split(CURSOR_SEPARATOR);

  if (parts.length !== 2) {
    return null;
  }

  const createdAt = readTimestamp(parts[0]);
  const id = readIdentifier(parts[1]);

  return createdAt && id ? { createdAt, id } : null;
}

/**
 * A page shorter than the one that was asked for is the last page: offering a
 * "more" link there would lead to an empty screen.
 */
export function nextTimelineCursor(
  entries: readonly TimelineEntry[],
  pageSize: number,
): string | null {
  if (entries.length === 0 || entries.length < pageSize) {
    return null;
  }

  const last = entries[entries.length - 1];

  return encodeTimelineCursor({ createdAt: last.createdAt, id: last.id });
}
