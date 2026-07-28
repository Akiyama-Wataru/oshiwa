"use client";

import { FormStatus } from "@/app/components/FormStatus";
import { useActionFormState } from "@/app/components/useActionFormState";
import type {
  NotificationAction,
  NotificationActionState,
} from "@/app/notifications/actions";

const initialState: NotificationActionState = { status: "idle", message: "" };

export function MarkAllReadForm({ action }: { action: NotificationAction }) {
  const [state, formAction, isPending] = useActionFormState(
    action,
    initialState,
  );
  const statusId = "notifications-mark-read-status";

  return (
    <form
      action={formAction}
      aria-describedby={statusId}
      className="notification-mark-read-form"
    >
      <button
        className="button button-secondary"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "更新中" : "すべて既読にする"}
      </button>
      <FormStatus id={statusId} message={state.message} status={state.status} />
    </form>
  );
}
