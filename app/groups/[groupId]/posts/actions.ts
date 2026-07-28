"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type SupportedImageExtension,
  type SupportedImageMimeType,
  inspectImageUpload,
} from "@/lib/media/image-signature";
import { POST_IMAGE_BUCKET } from "@/lib/posts/storage";
import {
  IMAGE_REJECTION_MESSAGES,
  removeStorageObjects,
  reportFailure,
  resolveServerClient,
} from "@/lib/supabase/action-support";
import {
  MAX_POST_IMAGES,
  buildPostImagePath,
  createPostImageId,
  createPostSchema,
  deletePostSchema,
  postGroupIdSchema,
  postIdSchema,
  postImagePathSchema,
  splitHashtagInput,
  updatePostSchema,
} from "@/lib/validation/posts";

export type PostActionState = {
  status: "idle" | "success" | "warning" | "error";
  message: string;
};

export type PostAction = (
  state: PostActionState,
  formData: FormData,
) => Promise<PostActionState>;

const SCOPE = "posts";

const CREATE_ERROR =
  "投稿できませんでした。入力内容を確認してもう一度お試しください。";
const UPDATE_ERROR =
  "投稿を更新できませんでした。権限と入力内容を確認してください。";
const DELETE_ERROR =
  "投稿を削除できませんでした。権限を確認してもう一度お試しください。";
const IMAGE_ERROR = "写真を登録できませんでした。もう一度お試しください。";
const IMAGE_REMOVE_ERROR =
  "写真を削除できませんでした。もう一度お試しください。";
const TOO_MANY_IMAGES_ERROR = `写真は1件の投稿につき${MAX_POST_IMAGES}枚までです。`;
const LOCAL_PREVIEW_ERROR = "ローカルプレビューでは投稿の管理が未設定です。";
const ORPHAN_WARNING =
  "保存しましたが、古い写真を削除できませんでした。時間をおいて再度お試しください。";
const PARTIAL_POST_WARNING =
  "投稿は残りましたが、写真を登録できませんでした。投稿を編集して写真を追加してください。";

function postsPath(groupId: string): string {
  return `/groups/${groupId}/posts`;
}

async function resolveClient(fallbackMessage: string) {
  return resolveServerClient({
    fallbackMessage,
    localPreviewMessage: LOCAL_PREVIEW_ERROR,
  });
}

async function discardObjects(paths: readonly string[]): Promise<boolean> {
  return removeStorageObjects(SCOPE, POST_IMAGE_BUCKET, paths);
}

type InspectedImage = {
  bytes: Uint8Array;
  contentType: SupportedImageMimeType;
  extension: SupportedImageExtension;
};

type ImageReading =
  | { ok: true; images: InspectedImage[] }
  | { ok: false; message: string };

function readUploadedFiles(formData: FormData, field = "image"): File[] {
  // An untouched file input still submits an entry, so the empty ones are
  // dropped before the count is judged.
  return formData
    .getAll(field)
    .flatMap((value) =>
      value !== null && typeof value !== "string" && value.size > 0
        ? [value]
        : [],
    );
}

/**
 * Every photo is re-identified from its own bytes before anything is written.
 * The type the browser declares is never trusted, and an SVG is a scriptable
 * document rather than a picture, so it is refused here.
 */
async function inspectFiles(files: readonly File[]): Promise<ImageReading> {
  if (files.length > MAX_POST_IMAGES) {
    return { ok: false, message: TOO_MANY_IMAGES_ERROR };
  }

  const images: InspectedImage[] = [];

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspection = inspectImageUpload(bytes, file.type);

    if (!inspection.ok) {
      return { ok: false, message: IMAGE_REJECTION_MESSAGES[inspection.reason] };
    }

    images.push({
      bytes,
      contentType: inspection.contentType,
      extension: inspection.extension,
    });
  }

  return { ok: true, images };
}

type ImageStorageResult =
  /** The object that was written but never recorded, if the run stopped. */
  { ok: true } | { ok: false; unrecordedPath: string | null };

async function storeImages(
  client: SupabaseClient,
  input: { groupId: string; postId: string; images: readonly InspectedImage[] },
): Promise<ImageStorageResult> {
  for (const image of input.images) {
    const objectPath = buildPostImagePath({
      groupId: input.groupId,
      postId: input.postId,
      extension: image.extension,
      randomId: createPostImageId(),
    });

    const upload = await client.storage
      .from(POST_IMAGE_BUCKET)
      .upload(objectPath, image.bytes, {
        contentType: image.contentType,
        upsert: false,
      });

    if (upload.error) {
      reportFailure(SCOPE, "storage.upload", upload.error);
      return { ok: false, unrecordedPath: null };
    }

    const { error } = await client.rpc("attach_post_image", {
      target_post_id: input.postId,
      new_image_path: objectPath,
    });

    if (error) {
      reportFailure(SCOPE, "attach_post_image", error);
      return { ok: false, unrecordedPath: objectPath };
    }
  }

  return { ok: true };
}

function readPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * A post whose photos are missing is not the post the member wrote, so the
 * whole thing is taken back rather than half kept. If even that fails the post
 * survives and the member is told, because silently losing their words would
 * be worse than an incomplete post.
 */
async function rollbackPost(
  client: SupabaseClient,
  postId: string,
  unrecordedPath: string | null,
): Promise<PostActionState> {
  const stray = unrecordedPath ? [unrecordedPath] : [];
  const { data, error } = await client.rpc("delete_post", {
    target_post_id: postId,
  });

  if (error) {
    reportFailure(SCOPE, "delete_post", error);
    await discardObjects(stray);
    return { status: "warning", message: PARTIAL_POST_WARNING };
  }

  await discardObjects([...new Set([...readPaths(data), ...stray])]);

  return { status: "error", message: IMAGE_ERROR };
}

export async function createPostAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const parsed = createPostSchema.safeParse({
    groupId: formData.get("groupId"),
    body: formData.get("body"),
    oshiIds: formData.getAll("oshiId"),
    hashtags: splitHashtagInput(formData.get("hashtags")),
  });

  if (!parsed.success) {
    return { status: "error", message: CREATE_ERROR };
  }

  const reading = await inspectFiles(readUploadedFiles(formData));

  if (!reading.ok) {
    return { status: "error", message: reading.message };
  }

  const resolution = await resolveClient(CREATE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("create_post", {
    target_group_id: parsed.data.groupId,
    post_body: parsed.data.body,
    oshi_ids: parsed.data.oshiIds,
    hashtags: parsed.data.hashtags,
  });

  if (error || typeof data !== "string") {
    reportFailure(SCOPE, "create_post", error ?? "refused");
    return { status: "error", message: CREATE_ERROR };
  }

  const stored = await storeImages(resolution.client, {
    groupId: parsed.data.groupId,
    postId: data,
    images: reading.images,
  });

  if (!stored.ok) {
    const outcome = await rollbackPost(
      resolution.client,
      data,
      stored.unrecordedPath,
    );

    // Only a surviving post changes what the timeline shows.
    if (outcome.status === "warning") {
      revalidatePath(postsPath(parsed.data.groupId));
    }

    return outcome;
  }

  revalidatePath(postsPath(parsed.data.groupId));

  return { status: "success", message: "投稿しました。" };
}

export async function updatePostAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const group = postGroupIdSchema.safeParse(formData.get("groupId"));
  const parsed = updatePostSchema.safeParse({
    postId: formData.get("postId"),
    body: formData.get("body"),
    oshiIds: formData.getAll("oshiId"),
    hashtags: splitHashtagInput(formData.get("hashtags")),
  });

  if (!group.success || !parsed.success) {
    return { status: "error", message: UPDATE_ERROR };
  }

  const resolution = await resolveClient(UPDATE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("update_post", {
    target_post_id: parsed.data.postId,
    post_body: parsed.data.body,
    oshi_ids: parsed.data.oshiIds,
    hashtags: parsed.data.hashtags,
  });

  if (error || data !== true) {
    reportFailure(SCOPE, "update_post", error ?? "refused");
    return { status: "error", message: UPDATE_ERROR };
  }

  revalidatePath(postsPath(group.data));

  return { status: "success", message: "投稿を更新しました。" };
}

export async function deletePostAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const group = postGroupIdSchema.safeParse(formData.get("groupId"));
  const parsed = deletePostSchema.safeParse({
    postId: formData.get("postId"),
  });

  if (!group.success || !parsed.success) {
    return { status: "error", message: DELETE_ERROR };
  }

  const resolution = await resolveClient(DELETE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("delete_post", {
    target_post_id: parsed.data.postId,
  });

  if (error) {
    reportFailure(SCOPE, "delete_post", error);
    return { status: "error", message: DELETE_ERROR };
  }

  const cleaned = await discardObjects(readPaths(data));

  revalidatePath(postsPath(group.data));

  return cleaned
    ? { status: "success", message: "投稿を削除しました。" }
    : { status: "warning", message: ORPHAN_WARNING };
}

export async function attachPostImageAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const group = postGroupIdSchema.safeParse(formData.get("groupId"));
  const post = postIdSchema.safeParse(formData.get("postId"));
  const reading = await inspectFiles(readUploadedFiles(formData));

  if (!group.success || !post.success) {
    return { status: "error", message: IMAGE_ERROR };
  }

  if (!reading.ok) {
    return { status: "error", message: reading.message };
  }

  if (reading.images.length === 0) {
    return { status: "error", message: IMAGE_REJECTION_MESSAGES.empty };
  }

  const resolution = await resolveClient(IMAGE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const stored = await storeImages(resolution.client, {
    groupId: group.data,
    postId: post.data,
    images: reading.images,
  });

  if (!stored.ok) {
    // The post never referenced this object, so it must not survive.
    await discardObjects(stored.unrecordedPath ? [stored.unrecordedPath] : []);
    return { status: "error", message: IMAGE_ERROR };
  }

  revalidatePath(postsPath(group.data));

  return { status: "success", message: "写真を追加しました。" };
}

export async function detachPostImageAction(
  _state: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const group = postGroupIdSchema.safeParse(formData.get("groupId"));
  const post = postIdSchema.safeParse(formData.get("postId"));
  const path = postImagePathSchema.safeParse(formData.get("imagePath"));

  if (!group.success || !post.success || !path.success) {
    return { status: "error", message: IMAGE_REMOVE_ERROR };
  }

  const resolution = await resolveClient(IMAGE_REMOVE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("detach_post_image", {
    target_post_id: post.data,
    target_image_path: path.data,
  });

  if (error || typeof data !== "string") {
    reportFailure(SCOPE, "detach_post_image", error ?? "refused");
    return { status: "error", message: IMAGE_REMOVE_ERROR };
  }

  const cleaned = await discardObjects([data]);

  revalidatePath(postsPath(group.data));

  return cleaned
    ? { status: "success", message: "写真を削除しました。" }
    : { status: "warning", message: ORPHAN_WARNING };
}
