"use client";

import { useActionState } from "react";

import type { JoinAction, JoinActionState } from "@/app/join/[token]/actions";

const initialState: JoinActionState = {
  status: "idle",
  message: "",
};

export function JoinForm({
  action,
  token,
}: {
  action: JoinAction;
  token: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <>
      <form
        action={formAction}
        className="auth-form"
        aria-describedby="password-help join-status"
      >
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="mode" value="setup" />
        <label>
          新しいパスワード
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            disabled={isPending}
          />
        </label>
        <label>
          パスワード（確認）
          <input
            type="password"
            name="passwordConfirmation"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            disabled={isPending}
          />
        </label>
        <p className="auth-helper" id="password-help">
          12文字以上で設定してください。
        </p>
        <button
          className="button button-primary"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "参加処理中" : "招待に参加する"}
        </button>
      </form>
      <p
        className={`auth-status ${state.status === "error" ? "is-error" : ""}`}
        id="join-status"
        aria-live="polite"
        role={state.status === "error" ? "alert" : "status"}
      >
        {isPending ? "招待を確認しています…" : state.message}
      </p>
    </>
  );
}
