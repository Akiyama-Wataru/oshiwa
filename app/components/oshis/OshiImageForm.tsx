"use client";

import { useActionState } from "react";

import { FormStatus } from "@/app/components/FormStatus";
import type {
  OshiAction,
  OshiActionState,
} from "@/app/groups/[groupId]/oshis/actions";
import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/media/image-signature";
import { withCompressedImages } from "@/lib/media/image-form-data";

const initialState: OshiActionState = { status: "idle", message: "" };

export function OshiImageForm({
  action,
  groupId,
  name,
  oshiId,
}: {
  action: OshiAction;
  groupId: string;
  name: string;
  oshiId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    async (previous: OshiActionState, formData: FormData) =>
      action(previous, await withCompressedImages(formData)),
    initialState,
  );
  const statusId = `oshi-image-status-${oshiId}`;

  return (
    <form action={formAction} aria-describedby={statusId} className="oshi-image-form">
      <input name="groupId" type="hidden" value={groupId} />
      <input name="oshiId" type="hidden" value={oshiId} />
      <label>
        {`${name}の写真`}
        <input
          accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
          disabled={isPending}
          name="image"
          required
          type="file"
        />
      </label>
      <button className="button button-secondary" disabled={isPending} type="submit">
        {isPending ? "送信中" : "写真を登録"}
      </button>
      <FormStatus
        id={statusId}
        message={isPending ? "写真を圧縮して送信しています…" : state.message}
        status={state.status}
      />
    </form>
  );
}
