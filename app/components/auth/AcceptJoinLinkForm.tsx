"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  AcceptJoinLinkAction,
  AcceptJoinLinkState,
} from "@/app/invite/[token]/actions";

const initialState: AcceptJoinLinkState = { status: "idle", message: "" };

export function AcceptJoinLinkForm({
  action,
  token,
}: {
  action: AcceptJoinLinkAction;
  token: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );

  return (
    <form
      action={formAction}
      aria-describedby="join-link-status"
      className="auth-form"
    >
      <input name="token" type="hidden" value={token} />
      {/* Joining is a decision, not something that happens because a link was
          opened: a preview in a chat app must not spend the link. */}
      <button className="button button-primary" disabled={isPending} type="submit">
        {isPending ? "参加しています" : "この輪に参加する"}
      </button>
      <FormStatus
        className="auth-status"
        id="join-link-status"
        message={state.message}
        status={state.status}
      />
    </form>
  );
}
