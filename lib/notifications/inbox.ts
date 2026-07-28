import { UNKNOWN_MEMBER_NAME } from "@/lib/posts/reactions";
import { lowercaseUuid } from "@/lib/validation/identifiers";

export const NOTIFICATION_KINDS = ["like", "reply", "share"] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type InboxEntry = {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  unread: boolean;
  groupId: string;
  groupName: string;
  postId: string;
  postExcerpt: string;
  replyBody: string | null;
  actorName: string;
  /** Where tapping it leads: the post itself, not the circle's timeline. */
  href: string;
};

/** Shown when the reader can no longer resolve the circle's name. */
const UNKNOWN_GROUP_NAME = "参加中の輪";

const identifier = lowercaseUuid("有効な識別子ではありません。");

function readIdentifier(value: unknown): string | null {
  const parsed = identifier.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readKind(value: unknown): NotificationKind | null {
  return NOTIFICATION_KINDS.includes(value as NotificationKind)
    ? (value as NotificationKind)
    : null;
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * A notification is only useful if it can be opened. Anything missing the ids
 * the link is built from is dropped rather than rendered as a dead entry.
 */
export function normalizeNotificationRows(value: unknown): InboxEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return [];
    }

    const row = candidate as Record<string, unknown>;
    const id = readIdentifier(row.id);
    const groupId = readIdentifier(row.group_id);
    const postId = readIdentifier(row.post_id);
    const kind = readKind(row.kind);
    const createdAt =
      typeof row.created_at === "string" && !Number.isNaN(Date.parse(row.created_at))
        ? row.created_at
        : null;

    if (!id || !groupId || !postId || !kind || !createdAt) {
      return [];
    }

    return [
      {
        id,
        kind,
        createdAt,
        unread: row.read_at === null || row.read_at === undefined,
        groupId,
        groupName: readText(row.group_name, UNKNOWN_GROUP_NAME),
        postId,
        // An excerpt is a courtesy rather than the point: the entry says who did
        // what, and the link leads to the post itself.
        postExcerpt: readText(row.post_excerpt, ""),
        replyBody: typeof row.reply_body === "string" ? row.reply_body : null,
        actorName: readText(row.actor_name, UNKNOWN_MEMBER_NAME),
        href: `/groups/${groupId}/posts/${postId}`,
      },
    ];
  });
}

const DESCRIPTIONS: Record<NotificationKind, string> = {
  like: "がいいねしました",
  reply: "が返信しました",
  share: "が輪に共有しました",
};

export function describeNotification(entry: InboxEntry): string {
  return `${entry.actorName}${DESCRIPTIONS[entry.kind]}`;
}
