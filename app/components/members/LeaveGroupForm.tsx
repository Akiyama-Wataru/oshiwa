"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  MemberAction,
  MemberActionState,
} from "@/app/groups/[groupId]/members/actions";

const initialState: MemberActionState = { status: "idle", message: "" };

export function LeaveGroupForm({
  action,
  groupId,
  groupName,
}: {
  action: MemberAction;
  groupId: string;
  groupName: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );

  return (
    <details className="member-leave-panel">
      <summary>この輪から抜ける</summary>
      <form
        action={formAction}
        aria-describedby="member-leave-status"
        className="member-leave-form"
      >
        {/* No user id: whose membership ends is read from the session. */}
        <input name="groupId" type="hidden" value={groupId} />
        <p>
          {`${groupName}のタイムラインは読めなくなります。書いた投稿と写真は輪に残ります。`}
        </p>
        <button
          className="button button-danger"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "処理中" : "抜ける"}
        </button>
        <FormStatus
          id="member-leave-status"
          message={state.message}
          status={state.status}
        />
      </form>
    </details>
  );
}
