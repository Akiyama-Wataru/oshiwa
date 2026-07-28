"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  PostAction,
  PostActionState,
} from "@/app/groups/[groupId]/posts/actions";

const initialState: PostActionState = { status: "idle", message: "" };

export function ReplyDeleteForm({
  action,
  authorName,
  groupId,
  postId,
  replyId,
}: {
  action: PostAction;
  authorName: string;
  groupId: string;
  postId: string;
  replyId: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );
  const statusId = `reply-delete-status-${replyId}`;

  return (
    <form
      action={formAction}
      aria-describedby={statusId}
      className="reply-delete-form"
    >
      <input name="groupId" type="hidden" value={groupId} />
      <input name="postId" type="hidden" value={postId} />
      <input name="replyId" type="hidden" value={replyId} />
      <button className="button button-quiet" disabled={isPending} type="submit">
        {isPending ? "削除中" : `${authorName}の返信を削除`}
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
