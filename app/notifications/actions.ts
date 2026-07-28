"use server";

import { revalidatePath } from "next/cache";

import {
  reportFailure,
  resolveServerClient,
} from "@/lib/supabase/action-support";

export type NotificationActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type NotificationAction = (
  state: NotificationActionState,
  formData: FormData,
) => Promise<NotificationActionState>;

const SCOPE = "notifications";

const MARK_READ_ERROR =
  "お知らせを既読にできませんでした。時間をおいてもう一度お試しください。";
const LOCAL_PREVIEW_ERROR = "ローカルプレビューではお知らせが未設定です。";

export async function markNotificationsReadAction(
  _state: NotificationActionState,
  _formData: FormData,
): Promise<NotificationActionState> {
  const resolution = await resolveServerClient({
    fallbackMessage: MARK_READ_ERROR,
    localPreviewMessage: LOCAL_PREVIEW_ERROR,
  });

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  // No ids are sent: the reader is looking at their whole list, and the
  // function limits itself to the rows addressed to them.
  const { error } = await resolution.client.rpc("mark_notifications_read", {
    notification_ids: null,
  });

  if (error) {
    reportFailure(SCOPE, "mark_notifications_read", error);
    return { status: "error", message: MARK_READ_ERROR };
  }

  revalidatePath("/notifications");
  revalidatePath("/groups");

  return { status: "success", message: "すべて既読にしました。" };
}
