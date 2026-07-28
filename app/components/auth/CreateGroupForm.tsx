"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  CreateGroupAction,
  CreateGroupActionState,
} from "@/app/groups/actions";

const initialState: CreateGroupActionState = {
  status: "idle",
  message: "",
};

export function CreateGroupForm({ action }: { action: CreateGroupAction }) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="group-create-form"
      aria-describedby="create-group-status"
    >
      <label>
        グループ名
        <input
          type="text"
          name="name"
          minLength={1}
          maxLength={100}
          autoComplete="off"
          placeholder="例：ライブ遠征組"
          required
          disabled={isPending}
        />
      </label>
      <button
        className="button button-primary"
        type="submit"
        disabled={isPending}
      >
        {isPending ? "作成中" : "グループを作る"}
      </button>
      <FormStatus
        id="create-group-status"
        message={isPending ? "グループを作成しています…" : state.message}
        status={state.status}
      />
    </form>
  );
}
