"use client";

import { useActionState } from "react";

import type {
  LogoutAction,
  LogoutActionState,
} from "@/app/groups/actions";

const initialState: LogoutActionState = {
  status: "idle",
  message: "",
};

export function LogoutButton({ action }: { action: LogoutAction }) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction}>
      <button
        className="button button-secondary"
        type="submit"
        disabled={isPending}
      >
        {isPending ? "ログアウト中" : "ログアウト"}
      </button>
      <p className="auth-inline-status" aria-live="polite" role="status">
        {state.message}
      </p>
    </form>
  );
}
