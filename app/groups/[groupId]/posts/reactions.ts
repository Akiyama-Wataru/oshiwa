"use server";

import { revalidatePath } from "next/cache";

import type { PostActionState } from "@/app/groups/[groupId]/posts/actions";
import {
  reportFailure,
  resolveServerClient,
} from "@/lib/supabase/action-support";
import {
  createReplySchema,
  deleteReplySchema,
  sharePostSchema,
  togglePostLikeSchema,
  unsharePostSchema,
} from "@/lib/validation/reactions";

const SCOPE = "reactions";

const LIKE_ERROR =
  "いいねを変更できませんでした。時間をおいてもう一度お試しください。";
const REPLY_ERROR =
  "返信できませんでした。入力内容を確認してもう一度お試しください。";
const REPLY_REMOVE_ERROR =
  "返信を削除できませんでした。権限を確認してもう一度お試しください。";
const SHARE_ERROR =
  "共有できませんでした。時間をおいてもう一度お試しください。";
const ALREADY_SHARED_ERROR = "この投稿はすでに共有しています。";
const UNSHARE_ERROR =
  "共有を取り消せませんでした。時間をおいてもう一度お試しください。";
const LOCAL_PREVIEW_ERROR = "ローカルプレビューでは反応の記録が未設定です。";

/**
 * A reaction shows up on the timeline and on the post's own page, and a member
 * may be looking at either one, so both are refreshed.
 */
function revalidateReaction(groupId: string, postId: string | null): void {
  revalidatePath(`/groups/${groupId}/posts`);

  if (postId) {
    revalidatePath(`/groups/${groupId}/posts/${postId}`);
  }
}

async function resolveClient(fallbackMessage: string) {
  return resolveServerClient({
    fallbackMessage,
    localPreviewMessage: LOCAL_PREVIEW_ERROR,
  });
}

export async function togglePostLikeAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const parsed = togglePostLikeSchema.safeParse({
    groupId: formData.get("groupId"),
    postId: formData.get("postId"),
  });

  if (!parsed.success) {
    return { status: "error", message: LIKE_ERROR };
  }

  const resolution = await resolveClient(LIKE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("toggle_post_like", {
    target_post_id: parsed.data.postId,
  });

  if (error || typeof data !== "boolean") {
    reportFailure(SCOPE, "toggle_post_like", error ?? "refused");
    return { status: "error", message: LIKE_ERROR };
  }

  revalidateReaction(parsed.data.groupId, parsed.data.postId);

  return {
    status: "success",
    message: data ? "いいねしました。" : "いいねを取り消しました。",
  };
}

export async function createReplyAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const parsed = createReplySchema.safeParse({
    groupId: formData.get("groupId"),
    postId: formData.get("postId"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? REPLY_ERROR,
    };
  }

  const resolution = await resolveClient(REPLY_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("create_reply", {
    target_post_id: parsed.data.postId,
    reply_body: parsed.data.body,
  });

  if (error || typeof data !== "string") {
    reportFailure(SCOPE, "create_reply", error ?? "refused");
    return { status: "error", message: REPLY_ERROR };
  }

  revalidateReaction(parsed.data.groupId, parsed.data.postId);

  return { status: "success", message: "返信しました。" };
}

export async function deleteReplyAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const parsed = deleteReplySchema.safeParse({
    groupId: formData.get("groupId"),
    replyId: formData.get("replyId"),
  });

  if (!parsed.success) {
    return { status: "error", message: REPLY_REMOVE_ERROR };
  }

  const resolution = await resolveClient(REPLY_REMOVE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("delete_reply", {
    target_reply_id: parsed.data.replyId,
  });

  if (error || data !== true) {
    reportFailure(SCOPE, "delete_reply", error ?? "refused");
    return { status: "error", message: REPLY_REMOVE_ERROR };
  }

  // The reply id is enough to remove it, but not enough to name the post it
  // belonged to, so only the timeline is refreshed by path here.
  const postId = formData.get("postId");

  revalidateReaction(
    parsed.data.groupId,
    typeof postId === "string" ? postId : null,
  );

  return { status: "success", message: "返信を削除しました。" };
}

export async function sharePostAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const parsed = sharePostSchema.safeParse({
    groupId: formData.get("groupId"),
    postId: formData.get("postId"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? SHARE_ERROR,
    };
  }

  const resolution = await resolveClient(SHARE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("share_post", {
    target_post_id: parsed.data.postId,
    // Named explicitly so that carrying a post out of its own circle is a
    // refusal rather than an oversight on either side.
    target_group_id: parsed.data.groupId,
    share_note: parsed.data.note,
  });

  if (error || typeof data !== "string") {
    reportFailure(SCOPE, "share_post", error ?? "refused");

    return {
      status: "error",
      message: /already shared/iu.test(String((error as Error | null)?.message))
        ? ALREADY_SHARED_ERROR
        : SHARE_ERROR,
    };
  }

  revalidateReaction(parsed.data.groupId, parsed.data.postId);

  return { status: "success", message: "輪のみんなに共有しました。" };
}

export async function unsharePostAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const parsed = unsharePostSchema.safeParse({
    groupId: formData.get("groupId"),
    postId: formData.get("postId"),
  });

  if (!parsed.success) {
    return { status: "error", message: UNSHARE_ERROR };
  }

  const resolution = await resolveClient(UNSHARE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("unshare_post", {
    target_post_id: parsed.data.postId,
  });

  if (error || data !== true) {
    reportFailure(SCOPE, "unshare_post", error ?? "refused");
    return { status: "error", message: UNSHARE_ERROR };
  }

  revalidateReaction(parsed.data.groupId, parsed.data.postId);

  return { status: "success", message: "共有を取り消しました。" };
}
