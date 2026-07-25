"use client";

import { useActionState } from "react";

import { FormStatus } from "@/app/components/oshis/FormStatus";
import { MemberColorField } from "@/app/components/oshis/MemberColorField";
import type {
  OshiAction,
  OshiActionState,
} from "@/app/groups/[groupId]/oshis/actions";
import { OSHI_NAME_MAX_LENGTH } from "@/lib/validation/oshis";

const initialState: OshiActionState = { status: "idle", message: "" };

export function OshiEditForm({
  action,
  color,
  groupId,
  name,
  oshiId,
}: {
  action: OshiAction;
  color: string;
  groupId: string;
  name: string;
  oshiId: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const statusId = `edit-oshi-status-${oshiId}`;

  return (
    <form action={formAction} aria-describedby={statusId} className="oshi-edit-form">
      <input name="groupId" type="hidden" value={groupId} />
      <input name="oshiId" type="hidden" value={oshiId} />
      <label>
        {`${name}の名前`}
        <input
          autoComplete="off"
          defaultValue={name}
          disabled={isPending}
          maxLength={OSHI_NAME_MAX_LENGTH}
          minLength={1}
          name="name"
          required
          type="text"
        />
      </label>
      <MemberColorField
        defaultValue={color}
        disabled={isPending}
        ownerLabel={name}
      />
      <button className="button button-secondary" disabled={isPending} type="submit">
        {isPending ? "保存中" : "変更を保存"}
      </button>
      <FormStatus id={statusId} message={state.message} status={state.status} />
    </form>
  );
}
