"use client";

import { useActionState } from "react";

import { FormStatus } from "@/app/components/FormStatus";
import type {
  PostAction,
  PostActionState,
} from "@/app/groups/[groupId]/posts/actions";

const initialState: PostActionState = { status: "idle", message: "" };

export function PostDeleteForm({
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
  const [state, formAction, isPending] = useActionState(action, initialState);
  const statusId = `post-delete-status-${postId}`;

  return (
    <form
      action={formAction}
      aria-describedby={statusId}
      className="post-delete-form"
    >
      <input name="groupId" type="hidden" value={groupId} />
      <input name="postId" type="hidden" value={postId} />
      <button className="button button-danger" disabled={isPending} type="submit">
        {isPending ? "削除中" : `${authorName}の投稿を削除`}
      </button>
      <FormStatus id={statusId} message={state.message} status={state.status} />
    </form>
  );
}
