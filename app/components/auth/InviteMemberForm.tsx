"use client";

import { useActionState } from "react";

import { ManualInviteLink } from "@/app/components/auth/ManualInviteLink";
import type {
  InviteMemberAction,
  InviteMemberActionState,
} from "@/app/groups/actions";

const initialState: InviteMemberActionState = {
  status: "idle",
  message: "",
  manualLink: null,
};

export function InviteMemberForm({
  action,
  groupId,
  groupName,
}: {
  action: InviteMemberAction;
  groupId: string;
  groupName: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form
      action={formAction}
      className="invite-member-form"
      aria-label={`${groupName}にメンバーを招待`}
      aria-describedby={`invite-status-${groupId}`}
    >
      <input type="hidden" name="groupId" value={groupId} />
      <div className="invite-form-grid">
        <label>
          招待するメールアドレス
          <input
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            placeholder="friend@example.com"
            required
            disabled={isPending}
          />
        </label>
        <label>
          権限
          <select name="role" defaultValue="member" disabled={isPending}>
            <option value="member">メンバー</option>
            <option value="admin">管理者</option>
          </select>
        </label>
      </div>
      <button
        className="button button-secondary"
        type="submit"
        disabled={isPending}
      >
        {isPending ? "招待作成中" : "招待を作成"}
      </button>
      <div
        className={`invite-result is-${state.status}`}
        id={`invite-status-${groupId}`}
        data-testid="invite-status"
        role="status"
      >
        <p>{isPending ? "招待を安全に作成しています…" : state.message}</p>
        {state.manualLink ? (
          <div className="manual-invite-link">
            <p>メールが届かない場合の手動リンク：</p>
            <ManualInviteLink path={state.manualLink} />
          </div>
        ) : null}
      </div>
    </form>
  );
}
