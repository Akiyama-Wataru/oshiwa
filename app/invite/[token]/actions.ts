"use server";

import { redirect } from "next/navigation";

import {
  reportFailure,
  resolveServerClient,
} from "@/lib/supabase/action-support";
import { acceptJoinLinkSchema } from "@/lib/validation/join-links";

export type AcceptJoinLinkState = {
  status: "idle" | "error";
  message: string;
};

export type AcceptJoinLinkAction = (
  state: AcceptJoinLinkState,
  formData: FormData,
) => Promise<AcceptJoinLinkState>;

const SCOPE = "join-link";

const ACCEPT_ERROR =
  "この参加リンクは使えません。すでに使われたか、期限が切れています。";
const LOCAL_PREVIEW_ERROR =
  "ローカルプレビューでは参加リンクの受け取りが未設定です。";

export async function acceptJoinLinkAction(
  _state: AcceptJoinLinkState,
  formData: FormData,
): Promise<AcceptJoinLinkState> {
  const parsed = acceptJoinLinkSchema.safeParse({
    token: formData.get("token"),
  });

  if (!parsed.success) {
    return { status: "error", message: ACCEPT_ERROR };
  }

  const resolution = await resolveServerClient({
    fallbackMessage: ACCEPT_ERROR,
    localPreviewMessage: LOCAL_PREVIEW_ERROR,
  });

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc(
    "accept_group_join_link",
    { link_token: parsed.data.token },
  );

  // Spent, revoked, expired and unknown all answer the same, here as in the
  // database: a different message for each would say whether a link exists.
  if (error || typeof data !== "string") {
    reportFailure(SCOPE, "accept_group_join_link", error ?? "refused");
    return { status: "error", message: ACCEPT_ERROR };
  }

  redirect(`/groups/${data}/posts`);
}
