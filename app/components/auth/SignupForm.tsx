"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type { SignupAction, SignupActionState } from "@/app/signup/actions";

const initialState: SignupActionState = {
  status: "idle",
  message: "",
};

export function SignupForm({
  action,
  returnTo,
}: {
  action: SignupAction;
  returnTo: string;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );

  return (
    <>
      <form
        action={formAction}
        className="auth-form"
        aria-describedby="signup-help signup-status"
      >
        <input type="hidden" name="returnTo" value={returnTo} />
        <label>
          表示名
          <input
            type="text"
            name="displayName"
            autoComplete="nickname"
            maxLength={40}
            placeholder="輪のみんなに見える名前"
            required
            disabled={isPending}
          />
        </label>
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
        <div className="auth-field">
          <label>
            パスワード
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              disabled={isPending}
              aria-describedby="signup-password-help"
            />
          </label>
          <p className="auth-field-help" id="signup-password-help">
            12文字以上で入力してください。
          </p>
        </div>
        <button
          className="button button-primary"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "登録中" : "登録する"}
        </button>
      </form>

      <p className="auth-helper" id="signup-help">
        登録しただけでは、どの輪も見えません。参加リンクを受け取ると輪に入れます。
      </p>
      <FormStatus
        className="auth-status"
        id="signup-status"
        message={
          isPending
            ? "登録しています…"
            : state.message ||
              "メールアドレスとパスワードで登録できます。"
        }
        status={state.status === "error" ? "error" : "idle"}
      />
    </>
  );
}
