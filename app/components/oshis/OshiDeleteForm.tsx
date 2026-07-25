"use client";

import { useActionState } from "react";

import { FormStatus } from "@/app/components/oshis/FormStatus";
import type {
  OshiAction,
  OshiActionState,
} from "@/app/groups/[groupId]/oshis/actions";

const initialState: OshiActionState = { status: "idle", message: "" };

export function OshiDeleteForm({
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
  const [state, formAction, isPending] = useActionState(action, initialState);
  const statusId = `oshi-delete-status-${oshiId}`;

  return (
    <details className="oshi-delete-panel">
      <summary>{`${name}を削除`}</summary>
      <form action={formAction} aria-describedby={statusId} className="oshi-delete-form">
        <input name="groupId" type="hidden" value={groupId} />
        <input name="oshiId" type="hidden" value={oshiId} />
        <p>削除すると、登録した写真も一緒に消えます。元には戻せません。</p>
        <button className="button button-danger" disabled={isPending} type="submit">
          {isPending ? "削除中" : `${name}を完全に削除`}
        </button>
        <FormStatus id={statusId} message={state.message} status={state.status} />
      </form>
    </details>
  );
}
