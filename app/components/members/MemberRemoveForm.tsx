"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  MemberAction,
  MemberActionState,
} from "@/app/groups/[groupId]/members/actions";

const initialState: MemberActionState = { status: "idle", message: "" };

export function MemberRemoveForm({
  action,
  displayName,
  groupId,
  userId,
}: {
  action: MemberAction;
  displayName: string;
  groupId: string;
  userId: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );
  const statusId = `member-remove-status-${userId}`;

  return (
    <form
      action={formAction}
      aria-describedby={statusId}
      className="member-remove-form"
    >
      <input name="groupId" type="hidden" value={groupId} />
      <input name="userId" type="hidden" value={userId} />
      <button className="button button-danger" disabled={isPending} type="submit">
        {isPending ? "処理中" : `${displayName}を輪から外す`}
      </button>
      <p className="post-field-hint">
        投稿と写真は残ります。もう一度招待すれば戻れます。
      </p>
      <FormStatus id={statusId} message={state.message} status={state.status} />
    </form>
  );
}
