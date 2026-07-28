"use server";

import { revalidatePath } from "next/cache";

import { inspectImageUpload } from "@/lib/media/image-signature";
import { OSHI_IMAGE_BUCKET } from "@/lib/oshis/storage";
import {
  IMAGE_REJECTION_MESSAGES,
  removeStorageObjects,
  reportFailure,
  resolveServerClient,
} from "@/lib/supabase/action-support";
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

const SCOPE = "oshis";

function oshisPath(groupId: string): string {
  return `/groups/${groupId}/oshis`;
}

async function resolveClient(fallbackMessage: string) {
  return resolveServerClient({
    fallbackMessage,
    localPreviewMessage: LOCAL_PREVIEW_ERROR,
  });
}

async function discardObjects(paths: readonly string[]): Promise<boolean> {
  return removeStorageObjects(SCOPE, OSHI_IMAGE_BUCKET, paths);
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

  const resolution = await resolveClient(CREATE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { error } = await resolution.client.rpc("create_oshi", {
    target_group_id: parsed.data.groupId,
    oshi_name: parsed.data.name,
    oshi_color: parsed.data.color,
  });

  if (error) {
    reportFailure(SCOPE, "create_oshi", error);
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

  const resolution = await resolveClient(UPDATE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("update_oshi", {
    target_oshi_id: parsed.data.oshiId,
    oshi_name: parsed.data.name,
    oshi_color: parsed.data.color,
  });

  if (error || data !== true) {
    reportFailure(SCOPE, "update_oshi", error ?? "refused");
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

  const resolution = await resolveClient(DELETE_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { data, error } = await resolution.client.rpc("delete_oshi", {
    target_oshi_id: parsed.data.oshiId,
  });

  if (error) {
    reportFailure(SCOPE, "delete_oshi", error);
    return { status: "error", message: DELETE_ERROR };
  }

  const orphanedPath = typeof data === "string" ? data : null;
  const cleaned = await discardObjects(orphanedPath ? [orphanedPath] : []);

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

  const resolution = await resolveClient(REORDER_ERROR);

  if (!resolution.ok) {
    return { status: "error", message: resolution.message };
  }

  const { error } = await resolution.client.rpc("reorder_oshis", {
    target_group_id: parsed.data.groupId,
    ordered_ids: parsed.data.orderedIds,
  });

  if (error) {
    reportFailure(SCOPE, "reorder_oshis", error);
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

  const resolution = await resolveClient(IMAGE_ERROR);

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
    reportFailure(SCOPE, "storage.upload", upload.error);
    return { status: "error", message: IMAGE_ERROR };
  }

  const { data, error } = await resolution.client.rpc("set_oshi_image", {
    target_oshi_id: oshi.data,
    new_image_path: objectPath,
  });

  if (error) {
    reportFailure(SCOPE, "set_oshi_image", error);
    // The row never referenced this object, so it must not survive the failure.
    await discardObjects([objectPath]);
    return { status: "error", message: IMAGE_ERROR };
  }

  const replacedPath = typeof data === "string" ? data : null;
  const cleaned = await discardObjects(
    replacedPath ? [replacedPath] : [],
  );

  revalidatePath(oshisPath(group.data));

  return cleaned
    ? { status: "success", message: "画像を登録しました。" }
    : { status: "warning", message: ORPHAN_WARNING };
}
