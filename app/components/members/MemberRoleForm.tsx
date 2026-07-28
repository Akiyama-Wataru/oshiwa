"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  MemberAction,
  MemberActionState,
} from "@/app/groups/[groupId]/members/actions";
import { MEMBERSHIP_ROLES, ROLE_LABELS } from "@/lib/members/roster";
import type { MembershipRole } from "@/lib/members/roster";

const initialState: MemberActionState = { status: "idle", message: "" };

export function MemberRoleForm({
  action,
  displayName,
  groupId,
  role,
  userId,
}: {
  action: MemberAction;
  displayName: string;
  groupId: string;
  role: MembershipRole;
  userId: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );
  const statusId = `member-role-status-${userId}`;
  const selectId = `member-role-${userId}`;

  return (
    <form
      action={formAction}
      aria-describedby={statusId}
      className="member-role-form"
    >
      <input name="groupId" type="hidden" value={groupId} />
      <input name="userId" type="hidden" value={userId} />
      <label className="post-field" htmlFor={selectId}>
        {`${displayName}の権限`}
        <select
          defaultValue={role}
          disabled={isPending}
          id={selectId}
          name="role"
        >
          {MEMBERSHIP_ROLES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {ROLE_LABELS[candidate]}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button button-secondary"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "変更中" : "権限を変更"}
      </button>
      <FormStatus id={statusId} message={state.message} status={state.status} />
    </form>
  );
}
