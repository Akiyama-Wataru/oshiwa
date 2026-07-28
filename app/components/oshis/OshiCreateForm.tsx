"use client";

import { useActionState } from "react";

import { FormStatus } from "@/app/components/FormStatus";
import { MemberColorField } from "@/app/components/oshis/MemberColorField";
import type {
  OshiAction,
  OshiActionState,
} from "@/app/groups/[groupId]/oshis/actions";
import { OSHI_NAME_MAX_LENGTH } from "@/lib/validation/oshis";

const initialState: OshiActionState = { status: "idle", message: "" };

export function OshiCreateForm({
  action,
  groupId,
}: {
  action: OshiAction;
  groupId: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form
      action={formAction}
      aria-describedby="create-oshi-status"
      className="oshi-create-form"
    >
      <input name="groupId" type="hidden" value={groupId} />
      <label>
        推しの名前
        <input
          autoComplete="off"
          disabled={isPending}
          maxLength={OSHI_NAME_MAX_LENGTH}
          minLength={1}
          name="name"
          placeholder="例：ミナ"
          required
          type="text"
        />
      </label>
      <MemberColorField disabled={isPending} ownerLabel="新しい推し" />
      <button className="button button-primary" disabled={isPending} type="submit">
        {isPending ? "追加中" : "推しを追加"}
      </button>
      <FormStatus
        id="create-oshi-status"
        message={isPending ? "推しを追加しています…" : state.message}
        status={state.status}
      />
    </form>
  );
}
