"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  PostAction,
  PostActionState,
} from "@/app/groups/[groupId]/posts/actions";
import { REPLY_BODY_MAX_LENGTH } from "@/lib/validation/reactions";

const initialState: PostActionState = { status: "idle", message: "" };

export function PostReplyForm({
  action,
  authorName,
  groupId,
  postId,
}: {
  action: PostAction;
  authorName: string;
  groupId: string;
  postId: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );
  const fieldId = `post-reply-body-${postId}`;
  const statusId = `post-reply-status-${postId}`;

  return (
    <form action={formAction} className="post-reply-form">
      <input name="groupId" type="hidden" value={groupId} />
      <input name="postId" type="hidden" value={postId} />

      <div className="post-field">
        <label htmlFor={fieldId}>{`${authorName}の投稿に返信`}</label>
        <textarea
          aria-describedby={statusId}
          disabled={isPending}
          id={fieldId}
          maxLength={REPLY_BODY_MAX_LENGTH}
          name="body"
          required
          rows={2}
        />
      </div>

      <button
        className="button button-secondary"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "送信中" : "返信する"}
      </button>

      <FormStatus
        className="post-inline-status"
        id={statusId}
        message={state.message}
        status={state.status}
      />
    </form>
  );
}
