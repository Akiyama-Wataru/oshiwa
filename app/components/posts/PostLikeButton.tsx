"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  PostAction,
  PostActionState,
} from "@/app/groups/[groupId]/posts/actions";

const initialState: PostActionState = { status: "idle", message: "" };

export function PostLikeButton({
  action,
  groupId,
  likeCount,
  liked,
  postId,
}: {
  action: PostAction;
  groupId: string;
  likeCount: number;
  liked: boolean;
  postId: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );
  const statusId = `post-like-status-${postId}`;

  return (
    <form
      action={formAction}
      aria-describedby={statusId}
      className="post-like-form"
    >
      <input name="groupId" type="hidden" value={groupId} />
      <input name="postId" type="hidden" value={postId} />
      {/* One button for both directions, because the database has one toggle:
          a separate "unlike" control could fall out of step with it. */}
      <button
        aria-pressed={liked}
        className={`post-like-button ${liked ? "is-liked" : ""}`}
        disabled={isPending}
        type="submit"
      >
        <span aria-hidden="true">{liked ? "♥" : "♡"}</span>
        {`いいね（${likeCount}件）`}
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
