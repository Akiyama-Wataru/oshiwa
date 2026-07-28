import { z } from "zod";

import { MEMBER_COLOR_PALETTE } from "@/lib/oshis/member-color";
import type { SupportedImageExtension } from "@/lib/media/image-signature";
import {
  createObjectId,
  lowercaseUuid,
  scopedObjectPathPattern,
} from "@/lib/validation/identifiers";
import { UNSAFE_DISPLAY_CHARACTER_PATTERN } from "@/lib/validation/text";

export const MAX_OSHIS_PER_GROUP = 50;
export const OSHI_NAME_MAX_LENGTH = 40;

export const oshiGroupIdSchema = lowercaseUuid(
  "有効なグループを選択してください。",
);
export const oshiIdSchema = lowercaseUuid("有効な推しを選択してください。");

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
  .regex(scopedObjectPathPattern(), "画像の保存先が不正です。");

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

export const createOshiImageId = createObjectId;

export type CreateOshiInput = z.infer<typeof createOshiSchema>;
export type UpdateOshiInput = z.infer<typeof updateOshiSchema>;
export type ReorderOshisInput = z.infer<typeof reorderOshisSchema>;
