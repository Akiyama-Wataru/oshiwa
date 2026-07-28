"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseConfigurationError } from "@/lib/env";
import {
  type ImageUploadRejection,
  inspectImageUpload,
} from "@/lib/media/image-signature";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { OSHI_IMAGE_BUCKET } from "@/lib/oshis/storage";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  buildOshiImagePath,
  createOshiImageId,
  createOshiSchema,
  deleteOshiSchema,
  oshiGroupIdSchema,
  oshiIdSchema,
  reorderOshisSchema,
  updateOshiSchema,
} from "@/lib/validation/oshis";

export type OshiActionState = {
  status: "idle" | "success" | "warning" | "error";
  message: string;
};

export type OshiAction = (
  state: OshiActionState,
  formData: FormData,
) => Promise<OshiActionState>;

const CREATE_ERROR =
  "推しを追加できませんでした。入力内容を確認してもう一度お試しください。";
const UPDATE_ERROR =
  "推しの情報を更新できませんでした。権限と入力内容を確認してください。";
const DELETE_ERROR =
  "推しを削除できませんでした。権限を確認してもう一度お試しください。";
const REORDER_ERROR =
  "並び順を保存できませんでした。管理者だけが並び替えできます。";
const IMAGE_ERROR =
  "画像を登録できませんでした。もう一度お試しください。";
const LOCAL_PREVIEW_ERROR = "ローカルプレビューでは推しの管理が未設定です。";
const ORPHAN_WARNING =
  "保存しましたが、古い画像を削除できませんでした。時間をおいて再度お試しください。";

const IMAGE_REJECTION_MESSAGES: Record<ImageUploadRejection, string> = {
  empty: "画像ファイルを選択してください。",
  "too-large": "画像は1MB以下に圧縮してから登録してください。",
  "unsupported-type": "画像はJPEG・PNG・WebPのみ登録できます。",
  "unsupported-format": "画像はJPEG・PNG・WebPのみ登録できます。",
  // A mismatch is almost always an attack, so it gets the same neutral copy.
  "declared-mismatch": "画像はJPEG・PNG・WebPのみ登録できます。",
};

/**
 * The messages returned to members are deliberately generic, so the cause has
 * to be recorded somewhere. This writes the operation and the database or
 * storage error, never the caller's data.
 */
function reportFailure(operation: string, cause: unknown): void {
  const detail =
    cause && typeof cause === "object" && "message" in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  console.error(`[oshis] ${operation} failed: ${detail}`);
}

type ClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; message: string };

function oshisPath(groupId: string): string {
  return `/groups/${groupId}/oshis`;
}

async function resolveServerClient(
  fallbackMessage: string,
): Promise<ClientResolution> {
  try {
    return { ok: true, client: await createServerSupabaseClient() };
  } catch (error) {
    if (
      error instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return { ok: false, message: LOCAL_PREVIEW_ERROR };
    }

    return { ok: false, message: fallbackMessage };
  }
}

/**
 * Storage cleanup runs with the service role because the caller has already
 * been authorized by the RPC that handed back the stale object path, and a
 * plain member is not allowed to delete objects directly.
 */
async function removeStorageObjects(paths: string[]): Promise<boolean> {
  if (paths.length === 0) {
    return true;
  }

  try {
    const admin = createAdminSupabaseClient();
    const { error } = await admin.storage
      .from(OSHI_IMAGE_BUCKET)
      .remove(paths);

    if (error) {
      reportFailure("storage.remove", error);
    }

    return !error;
  } catch (cause) {
    reportFailure("storage.remove", cause);
    return false;
  }
}

export async function createOshiAction(
  _state: OshiActionState,
  formData: FormData,
): Promise<OshiActionState> {
  const parsed = createOshiSchema.safeParse({
    groupId: formData.get("groupId"),
    name: formData.get("name"),
    color: formData.get("color"),
  });

  if (!parsed.success) {
    return { status: "error", message: CREATE_ERROR };
  }

  const resolution = await resolveServerClient(CREATE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { error } = await resolution.client.rpc("create_oshi", {
    target_group_id: parsed.data.groupId,
    oshi_name: parsed.data.name,
    oshi_color: parsed.data.color,
  });

  if (error) {
    reportFailure("create_oshi", error);
    return { status: "error", message: CREATE_ERROR };
  }

  revalidatePath(oshisPath(parsed.data.groupId));

  return { status: "success", message: "推しを追加しました。" };
}

export async function updateOshiAction(
  _state: OshiActionState,
  formData: FormData,
): Promise<OshiActionState> {
  const group = oshiGroupIdSchema.safeParse(formData.get("groupId"));
  const parsed = updateOshiSchema.safeParse({
    oshiId: formData.get("oshiId"),
    name: formData.get("name"),
    color: formData.get("color"),
  });

  if (!group.success || !parsed.success) {
    return { status: "error", message: UPDATE_ERROR };
  }

  const resolution = await resolveServerClient(UPDATE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("update_oshi", {
    target_oshi_id: parsed.data.oshiId,
    oshi_name: parsed.data.name,
    oshi_color: parsed.data.color,
  });

  if (error || data !== true) {
    reportFailure("update_oshi", error ?? "refused");
    return { status: "error", message: UPDATE_ERROR };
  }

  revalidatePath(oshisPath(group.data));

  return { status: "success", message: "推しの情報を更新しました。" };
}

export async function deleteOshiAction(
  _state: OshiActionState,
  formData: FormData,
): Promise<OshiActionState> {
  const group = oshiGroupIdSchema.safeParse(formData.get("groupId"));
  const parsed = deleteOshiSchema.safeParse({
    oshiId: formData.get("oshiId"),
  });

  if (!group.success || !parsed.success) {
    return { status: "error", message: DELETE_ERROR };
  }

  const resolution = await resolveServerClient(DELETE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("delete_oshi", {
    target_oshi_id: parsed.data.oshiId,
  });

  if (error) {
    reportFailure("delete_oshi", error);
    return { status: "error", message: DELETE_ERROR };
  }

  const orphanedPath = typeof data === "string" ? data : null;
  const cleaned = await removeStorageObjects(orphanedPath ? [orphanedPath] : []);

  revalidatePath(oshisPath(group.data));

  return cleaned
    ? { status: "success", message: "推しを削除しました。" }
    : { status: "warning", message: ORPHAN_WARNING };
}

export async function reorderOshisAction(
  _state: OshiActionState,
  formData: FormData,
): Promise<OshiActionState> {
  const parsed = reorderOshisSchema.safeParse({
    groupId: formData.get("groupId"),
    orderedIds: formData.getAll("oshiId"),
  });

  if (!parsed.success) {
    return { status: "error", message: REORDER_ERROR };
  }

  const resolution = await resolveServerClient(REORDER_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { error } = await resolution.client.rpc("reorder_oshis", {
    target_group_id: parsed.data.groupId,
    ordered_ids: parsed.data.orderedIds,
  });

  if (error) {
    reportFailure("reorder_oshis", error);
    return { status: "error", message: REORDER_ERROR };
  }

  revalidatePath(oshisPath(parsed.data.groupId));

  return { status: "success", message: "並び順を保存しました。" };
}

function readUploadedFile(value: FormDataEntryValue | null): File | null {
  return value !== null && typeof value !== "string" ? value : null;
}

export async function uploadOshiImageAction(
  _state: OshiActionState,
  formData: FormData,
): Promise<OshiActionState> {
  const group = oshiGroupIdSchema.safeParse(formData.get("groupId"));
  const oshi = oshiIdSchema.safeParse(formData.get("oshiId"));
  const file = readUploadedFile(formData.get("image"));

  if (!group.success || !oshi.success || !file) {
    return { status: "error", message: IMAGE_ERROR };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspection = inspectImageUpload(bytes, file.type);

  if (!inspection.ok) {
    return {
      status: "error",
      message: IMAGE_REJECTION_MESSAGES[inspection.reason],
    };
  }

  // The submitted name never reaches Storage: the object path is derived from
  // identifiers the database re-verifies, plus a random opaque segment.
  let objectPath: string;

  try {
    objectPath = buildOshiImagePath({
      groupId: group.data,
      oshiId: oshi.data,
      extension: inspection.extension,
      randomId: createOshiImageId(),
    });
  } catch {
    return { status: "error", message: IMAGE_ERROR };
  }

  const resolution = await resolveServerClient(IMAGE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const upload = await resolution.client.storage
    .from(OSHI_IMAGE_BUCKET)
    .upload(objectPath, bytes, {
      contentType: inspection.contentType,
      upsert: false,
    });

  if (upload.error) {
    reportFailure("storage.upload", upload.error);
    return { status: "error", message: IMAGE_ERROR };
  }

  const { data, error } = await resolution.client.rpc("set_oshi_image", {
    target_oshi_id: oshi.data,
    new_image_path: objectPath,
  });

  if (error) {
    reportFailure("set_oshi_image", error);
    // The row never referenced this object, so it must not survive the failure.
    await removeStorageObjects([objectPath]);
    return { status: "error", message: IMAGE_ERROR };
  }

  const replacedPath = typeof data === "string" ? data : null;
  const cleaned = await removeStorageObjects(
    replacedPath ? [replacedPath] : [],
  );

  revalidatePath(oshisPath(group.data));

  return cleaned
    ? { status: "success", message: "画像を登録しました。" }
    : { status: "warning", message: ORPHAN_WARNING };
}
