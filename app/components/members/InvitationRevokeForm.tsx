"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  MemberAction,
  MemberActionState,
} from "@/app/groups/[groupId]/members/actions";

const initialState: MemberActionState = { status: "idle", message: "" };

export function InvitationRevokeForm({
  action,
  email,
  groupId,
  invitationId,
}: {
  action: MemberAction;
  email: string;
  groupId: string;
  invitationId: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );
  const statusId = `invitation-revoke-status-${invitationId}`;

  return (
    <form
      action={formAction}
      aria-describedby={statusId}
      className="invitation-revoke-form"
    >
      <input name="groupId" type="hidden" value={groupId} />
      <input name="invitationId" type="hidden" value={invitationId} />
      <button
        className="button button-secondary"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "取消中" : `${email}の招待を取り消す`}
      </button>
      <FormStatus id={statusId} message={state.message} status={state.status} />
    </form>
  );
}
