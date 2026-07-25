"use client";

import { useActionState } from "react";

import type {
  CreateGroupAction,
  CreateGroupActionState,
} from "@/app/groups/actions";

const initialState: CreateGroupActionState = {
  status: "idle",
  message: "",
};

export function CreateGroupForm({ action }: { action: CreateGroupAction }) {
  const [state, formAction, isPending] = useActionState(action, initialState);

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
      <p
        className={`auth-inline-status ${state.status === "error" ? "is-error" : ""}`}
        id="create-group-status"
        aria-live="polite"
        role={state.status === "error" ? "alert" : "status"}
      >
        {isPending ? "グループを作成しています…" : state.message}
      </p>
    </form>
  );
}
