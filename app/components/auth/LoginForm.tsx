"use client";

import { useActionState } from "react";

import type {
  LoginAction,
  LoginActionState,
} from "@/app/login/actions";

const initialState: LoginActionState = {
  status: "idle",
  message: "",
};

export function LoginForm({
  action,
  returnTo,
}: {
  action: LoginAction;
  returnTo: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <>
      <form
        action={formAction}
        className="auth-form"
        aria-describedby="login-help login-status"
      >
        <input type="hidden" name="returnTo" value={returnTo} />
        <label>
          メールアドレス
          <input
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            required
            disabled={isPending}
          />
        </label>
        <label>
          パスワード
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            required
            disabled={isPending}
          />
        </label>
        <button
          className="button button-primary"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "ログイン中" : "ログインする"}
        </button>
      </form>

      <p className="auth-helper" id="login-help">
        アカウントはグループ管理者からの招待でのみ作成できます。
      </p>
      <p
        className={`auth-status ${state.status === "error" ? "is-error" : ""}`}
        id="login-status"
        aria-live="polite"
        role={state.status === "error" ? "alert" : "status"}
      >
        {isPending
          ? "ログインしています…"
          : state.message || "招待されたメールアドレスでログインしてください。"}
      </p>
    </>
  );
}
