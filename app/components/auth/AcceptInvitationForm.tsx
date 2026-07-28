"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type { JoinAction, JoinActionState } from "@/app/join/[token]/actions";

const initialState: JoinActionState = {
  status: "idle",
  message: "",
};

export function AcceptInvitationForm({
  action,
  token,
}: {
  action: JoinAction;
  token: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="auth-form"
      aria-describedby="join-status"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="mode" value="manual" />
      <div className="invite-note">
        <span aria-hidden="true">✦</span>
        <p>
          ログイン中のメールアドレスと招待先が一致する場合のみ参加できます。
        </p>
      </div>
      <button
        className="button button-primary"
        type="submit"
        disabled={isPending}
      >
        {isPending ? "参加処理中" : "この招待に参加する"}
      </button>
      <FormStatus
        className="auth-status"
        id="join-status"
        message={isPending ? "招待を確認しています…" : state.message}
        status={state.status}
      />
    </form>
  );
}
