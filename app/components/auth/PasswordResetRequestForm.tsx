"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  PasswordAction,
  PasswordActionState,
} from "@/app/password/actions";

const initialState: PasswordActionState = { status: "idle", message: "" };

export function PasswordResetRequestForm({
  action,
}: {
  action: PasswordAction;
}) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );

  return (
    <form
      action={formAction}
      aria-describedby="password-reset-status"
      className="auth-form"
    >
      <label>
        メールアドレス
        <input
          autoComplete="email"
          disabled={isPending}
          inputMode="email"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </label>
      <button
        className="button button-primary"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "送信中" : "再設定リンクを送る"}
      </button>
      <FormStatus
        className="auth-status"
        id="password-reset-status"
        message={
          isPending
            ? "再設定リンクを送信しています…"
            : state.message ||
              "登録済みのメールアドレス宛に再設定リンクを送ります。"
        }
        status={state.status}
      />
    </form>
  );
}
