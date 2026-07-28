"use client";

import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  LogoutAction,
  LogoutActionState,
} from "@/app/groups/actions";

const initialState: LogoutActionState = {
  status: "idle",
  message: "",
};

export function LogoutButton({ action }: { action: LogoutAction }) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );

  return (
    <form action={formAction}>
      <button
        className="button button-secondary"
        type="submit"
        disabled={isPending}
      >
        {isPending ? "ログアウト中" : "ログアウト"}
      </button>
      <p className="auth-inline-status" role="status">
        {state.message}
      </p>
    </form>
  );
}
