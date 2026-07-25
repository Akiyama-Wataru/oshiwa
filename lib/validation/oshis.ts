import { z } from "zod";

import { MEMBER_COLOR_PALETTE } from "@/lib/oshis/member-color";
import type { SupportedImageExtension } from "@/lib/media/image-signature";

export const MAX_OSHIS_PER_GROUP = 50;
export const OSHI_NAME_MAX_LENGTH = 40;

/**
 * C0 and C1 controls plus the zero-width and bidirectional overrides that let
 * one display name impersonate another. U+200D is allowed so emoji joiner
 * sequences keep working. Mirrors private.has_unsafe_display_characters.
 */
const UNSAFE_DISPLAY_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;

const UUID_SEGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const OSHI_IMAGE_PATH_PATTERN = new RegExp(
  `^${UUID_SEGMENT}/${UUID_SEGMENT}/[0-9a-f]{32}\\.(?:jpg|png|webp)$`,
);

// PostgreSQL renders uuids in lowercase, and object paths are matched against
// that rendering, so lowercase is the canonical form everywhere in the app.
export const oshiGroupIdSchema = z
  .uuid("有効なグループを選択してください。")
  .transform((value) => value.toLowerCase());
export const oshiIdSchema = z
  .uuid("有効な推しを選択してください。")
  .transform((value) => value.toLowerCase());

export const oshiNameSchema = z
  .string()
  .trim()
  .min(1, "推しの名前を入力してください。")
  .max(
    OSHI_NAME_MAX_LENGTH,
    `推しの名前は${OSHI_NAME_MAX_LENGTH}文字以内で入力してください。`,
  )
  .refine(
    (value) => !UNSAFE_DISPLAY_CHARACTER_PATTERN.test(value),
    "推しの名前に使用できない文字が含まれています。",
  );

export const memberColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z.enum(MEMBER_COLOR_PALETTE, "用意されたメンバーカラーから選んでください。"),
  );

export const oshiImagePathSchema = z
  .string()
  .regex(OSHI_IMAGE_PATH_PATTERN, "画像の保存先が不正です。");

export const createOshiSchema = z.object({
  groupId: oshiGroupIdSchema,
  name: oshiNameSchema,
  color: memberColorSchema,
});

export const updateOshiSchema = z.object({
  oshiId: oshiIdSchema,
  name: oshiNameSchema,
  color: memberColorSchema,
});

export const deleteOshiSchema = z.object({
  oshiId: oshiIdSchema,
});

export const reorderOshisSchema = z.object({
  groupId: oshiGroupIdSchema,
  orderedIds: z
    .array(oshiIdSchema)
    .min(1, "並び替える推しを選択してください。")
    .max(
      MAX_OSHIS_PER_GROUP,
      `推しは1グループにつき${MAX_OSHIS_PER_GROUP}人までです。`,
    )
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "同じ推しを重複して指定できません。",
    ),
});

export function buildOshiImagePath(input: {
  groupId: string;
  oshiId: string;
  extension: SupportedImageExtension;
  randomId: string;
}): string {
  const groupId = oshiGroupIdSchema.parse(input.groupId);
  const oshiId = oshiIdSchema.parse(input.oshiId);

  return oshiImagePathSchema.parse(
    `${groupId}/${oshiId}/${input.randomId}.${input.extension}`,
  );
}

/** 32 lowercase hex characters, matching the object-name segment above. */
export function createOshiImageId(
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  return randomUuid().replaceAll("-", "").toLowerCase();
}

export type CreateOshiInput = z.infer<typeof createOshiSchema>;
export type UpdateOshiInput = z.infer<typeof updateOshiSchema>;
export type ReorderOshisInput = z.infer<typeof reorderOshisSchema>;
