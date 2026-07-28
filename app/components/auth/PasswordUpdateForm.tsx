"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  PasswordAction,
  PasswordActionState,
} from "@/app/password/actions";

const initialState: PasswordActionState = { status: "idle", message: "" };

export function PasswordUpdateForm({ action }: { action: PasswordAction }) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );

  return (
    <form
      action={formAction}
      aria-describedby="password-update-status"
      className="auth-form"
    >
      {/* The browser silently refuses to submit a shorter password, so the
          requirement has to be readable before the button is pressed. */}
      <div className="auth-field">
        <label>
          新しいパスワード
          <input
            autoComplete="new-password"
            aria-describedby="password-update-help"
            disabled={isPending}
            maxLength={128}
            minLength={12}
            name="password"
            required
            type="password"
          />
        </label>
        <p className="auth-field-help" id="password-update-help">
          12文字以上で入力してください。
        </p>
      </div>
      <label>
        新しいパスワード（確認）
        <input
          autoComplete="new-password"
          disabled={isPending}
          maxLength={128}
          minLength={12}
          name="passwordConfirmation"
          required
          type="password"
        />
      </label>
      <button
        className="button button-primary"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "保存中" : "パスワードを設定する"}
      </button>
      <FormStatus
        className="auth-status"
        id="password-update-status"
        message={
          isPending ? "パスワードを保存しています…" : state.message
        }
        status={state.status}
      />
    </form>
  );
}
