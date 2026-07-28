"use client";

import { useActionState } from "react";

import { FormStatus } from "@/app/components/FormStatus";
import { OshiPicker } from "@/app/components/posts/OshiPicker";
import type {
  PostAction,
  PostActionState,
} from "@/app/groups/[groupId]/posts/actions";
import type { TimelineEntry, TimelineOshi } from "@/lib/posts/timeline";
import { POST_BODY_MAX_LENGTH } from "@/lib/validation/posts";

const initialState: PostActionState = { status: "idle", message: "" };

export function PostEditForm({
  action,
  entry,
  groupId,
  oshis,
}: {
  action: PostAction;
  entry: TimelineEntry;
  groupId: string;
  oshis: readonly TimelineOshi[];
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const statusId = `post-edit-status-${entry.id}`;

  return (
    <form action={formAction} aria-describedby={statusId} className="post-edit-form">
      <input name="groupId" type="hidden" value={groupId} />
      <input name="postId" type="hidden" value={entry.id} />

      <label className="post-field">
        本文
        <textarea
          defaultValue={entry.body}
          disabled={isPending}
          maxLength={POST_BODY_MAX_LENGTH}
          name="body"
          required
          rows={4}
        />
      </label>

      <OshiPicker
        disabled={isPending}
        idPrefix={`edit-${entry.id}`}
        oshis={oshis}
        selected={entry.oshis.map((oshi) => oshi.id)}
      />

      <label className="post-field">
        ハッシュタグ
        <input
          defaultValue={entry.hashtags.map((tag) => `#${tag}`).join(" ")}
          disabled={isPending}
          name="hashtags"
          type="text"
        />
      </label>

      <button className="button button-secondary" disabled={isPending} type="submit">
        {isPending ? "保存中" : "投稿を更新"}
      </button>

      <FormStatus id={statusId} message={state.message} status={state.status} />
    </form>
  );
}
