"use client";

import { useActionState } from "react";

import { FormStatus } from "@/app/components/FormStatus";
import type {
  PostAction,
  PostActionState,
} from "@/app/groups/[groupId]/posts/actions";
import { withCompressedImages } from "@/lib/media/image-form-data";
import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/media/image-signature";
import type { TimelineEntry } from "@/lib/posts/timeline";
import { MAX_POST_IMAGES } from "@/lib/validation/posts";

const initialState: PostActionState = { status: "idle", message: "" };

function PostImageDeleteForm({
  action,
  groupId,
  imagePath,
  position,
  postId,
}: {
  action: PostAction;
  groupId: string;
  imagePath: string;
  position: number;
  postId: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const statusId = `post-image-delete-status-${postId}-${position}`;

  return (
    <form
      action={formAction}
      aria-describedby={statusId}
      className="post-image-delete-form"
    >
      <input name="groupId" type="hidden" value={groupId} />
      <input name="postId" type="hidden" value={postId} />
      <input name="imagePath" type="hidden" value={imagePath} />
      <button className="button button-secondary" disabled={isPending} type="submit">
        {isPending ? "削除中" : `${position}枚目を削除`}
      </button>
      <FormStatus id={statusId} message={state.message} status={state.status} />
    </form>
  );
}

export function PostImageManager({
  attachAction,
  detachAction,
  entry,
  groupId,
}: {
  attachAction: PostAction;
  detachAction: PostAction;
  entry: TimelineEntry;
  groupId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    async (previous: PostActionState, formData: FormData) =>
      attachAction(previous, await withCompressedImages(formData)),
    initialState,
  );
  const statusId = `post-image-add-status-${entry.id}`;
  const remaining = MAX_POST_IMAGES - entry.images.length;

  return (
    <div className="post-image-manager">
      {entry.images.length > 0 ? (
        <ul className="post-image-actions" aria-label="登録済みの写真">
          {entry.images.map((image, index) => (
            <li key={image.imagePath}>
              <PostImageDeleteForm
                action={detachAction}
                groupId={groupId}
                imagePath={image.imagePath}
                position={index + 1}
                postId={entry.id}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {remaining > 0 ? (
        <form
          action={formAction}
          aria-describedby={statusId}
          className="post-image-add-form"
        >
          <input name="groupId" type="hidden" value={groupId} />
          <input name="postId" type="hidden" value={entry.id} />
          <label className="post-field">
            {`写真を追加（あと${remaining}枚）`}
            <input
              accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
              disabled={isPending}
              name="image"
              required
              type="file"
            />
          </label>
          <button
            className="button button-secondary"
            disabled={isPending}
            type="submit"
          >
            {isPending ? "送信中" : "写真を追加"}
          </button>
          <FormStatus
            id={statusId}
            message={isPending ? "写真を圧縮して送信しています…" : state.message}
            status={state.status}
          />
        </form>
      ) : (
        <p className="post-field-hint">{`写真は${MAX_POST_IMAGES}枚に達しています。`}</p>
      )}
    </div>
  );
}
