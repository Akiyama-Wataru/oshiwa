"use client";

import { useActionState } from "react";

import { FormStatus } from "@/app/components/FormStatus";
import { OshiPicker } from "@/app/components/posts/OshiPicker";
import type {
  PostAction,
  PostActionState,
} from "@/app/groups/[groupId]/posts/actions";
import { withCompressedImages } from "@/lib/media/image-form-data";
import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/media/image-signature";
import type { TimelineOshi } from "@/lib/posts/timeline";
import {
  MAX_POST_IMAGES,
  POST_BODY_MAX_LENGTH,
} from "@/lib/validation/posts";

const initialState: PostActionState = { status: "idle", message: "" };

export function PostComposer({
  action,
  groupId,
  oshis,
}: {
  action: PostAction;
  groupId: string;
  oshis: readonly TimelineOshi[];
}) {
  const [state, formAction, isPending] = useActionState(
    async (previous: PostActionState, formData: FormData) =>
      action(previous, await withCompressedImages(formData)),
    initialState,
  );

  return (
    <form
      action={formAction}
      aria-describedby="post-compose-status"
      className="post-composer"
    >
      <input name="groupId" type="hidden" value={groupId} />

      <label className="post-field">
        今日のできごと
        <textarea
          disabled={isPending}
          maxLength={POST_BODY_MAX_LENGTH}
          name="body"
          required
          rows={4}
        />
      </label>

      <OshiPicker idPrefix="compose" oshis={oshis} selected={[]} />

      {/* The hint sits beside the label rather than inside it: a label reads
          out as the field's name, and a name that recites the rules is worse
          than one that says what the field is. */}
      <div className="post-field">
        <label>
          ハッシュタグ
          <input
            aria-describedby="post-compose-hashtags-hint"
            disabled={isPending}
            name="hashtags"
            placeholder="#ライブ #尊い"
            type="text"
          />
        </label>
        <span className="post-field-hint" id="post-compose-hashtags-hint">
          空白や読点で区切ると、10件まで付けられます。
        </span>
      </div>

      <div className="post-field">
        <label>
          写真
          <input
            accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
            aria-describedby="post-compose-image-hint"
            disabled={isPending}
            multiple
            name="image"
            type="file"
          />
        </label>
        <span className="post-field-hint" id="post-compose-image-hint">
          {`1件の投稿につき${MAX_POST_IMAGES}枚までです。`}
        </span>
      </div>

      <button className="button button-primary" disabled={isPending} type="submit">
        {isPending ? "送信中" : "投稿する"}
      </button>

      <FormStatus
        id="post-compose-status"
        message={isPending ? "写真を圧縮して送信しています…" : state.message}
        status={state.status}
      />
    </form>
  );
}
