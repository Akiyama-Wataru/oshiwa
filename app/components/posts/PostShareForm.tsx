"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  PostAction,
  PostActionState,
} from "@/app/groups/[groupId]/posts/actions";
import { SHARE_NOTE_MAX_LENGTH } from "@/lib/validation/reactions";

const initialState: PostActionState = { status: "idle", message: "" };

/**
 * Sharing reaches everybody in the circle at once, so it is the noisiest thing
 * a member can do here. It stays folded away, and once it is done the same spot
 * offers the way back rather than a second share the database would refuse.
 */
export function PostShareForm({
  groupId,
  postId,
  shareAction,
  shareCount,
  sharedByViewer,
  unshareAction,
}: {
  groupId: string;
  postId: string;
  shareAction: PostAction;
  shareCount: number;
  sharedByViewer: boolean;
  unshareAction: PostAction;
}) {
  const [state, formAction, isPending] = useActionFormState(
    sharedByViewer ? unshareAction : shareAction,
    initialState,
  );
  const fieldId = `post-share-note-${postId}`;
  const statusId = `post-share-status-${postId}`;

  if (sharedByViewer) {
    return (
      <form
        action={formAction}
        aria-describedby={statusId}
        className="post-share-form"
      >
        <input name="groupId" type="hidden" value={groupId} />
        <input name="postId" type="hidden" value={postId} />
        <button
          className="button button-quiet"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "取り消し中" : "共有を取り消す"}
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

  return (
    <details className="post-share-panel">
      <summary>{`輪に共有（${shareCount}件）`}</summary>
      <form
        action={formAction}
        aria-describedby={statusId}
        className="post-share-form"
      >
        <input name="groupId" type="hidden" value={groupId} />
        <input name="postId" type="hidden" value={postId} />

        <div className="post-field">
          <label htmlFor={fieldId}>ひとこと（任意）</label>
          <input
            disabled={isPending}
            id={fieldId}
            maxLength={SHARE_NOTE_MAX_LENGTH}
            name="note"
            type="text"
          />
        </div>

        <button
          className="button button-secondary"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "共有中" : "この投稿を共有"}
        </button>
        <FormStatus
          className="post-inline-status"
          id={statusId}
          message={state.message}
          status={state.status}
        />
      </form>
    </details>
  );
}
