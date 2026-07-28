import { z } from "zod";

import type { SupportedImageExtension } from "@/lib/media/image-signature";
import {
  lowercaseUuid,
  scopedObjectPathPattern,
} from "@/lib/validation/identifiers";
import {
  UNSAFE_BODY_CHARACTER_PATTERN,
  UNSAFE_DISPLAY_CHARACTER_PATTERN,
  normalizeLineEndings,
} from "@/lib/validation/text";

export const POST_BODY_MAX_LENGTH = 2000;
export const HASHTAG_MAX_LENGTH = 30;
export const MAX_POST_IMAGES = 4;
export const MAX_POST_OSHIS = 10;
export const MAX_POST_HASHTAGS = 10;

export const postGroupIdSchema = lowercaseUuid(
  "有効なグループを選択してください。",
);
export const postIdSchema = lowercaseUuid("有効な投稿を選択してください。");
export const postOshiIdSchema = lowercaseUuid("有効な推しを選択してください。");

export const postBodySchema = z
  .string()
  .transform((value) => normalizeLineEndings(value).trim())
  .pipe(
    z
      .string()
      .min(1, "本文を入力してください。")
      .max(
        POST_BODY_MAX_LENGTH,
        `本文は${POST_BODY_MAX_LENGTH}文字以内で入力してください。`,
      )
      .refine(
        (value) => !UNSAFE_BODY_CHARACTER_PATTERN.test(value),
        "本文に使用できない文字が含まれています。",
      ),
  );

export const hashtagSchema = z
  .string()
  .transform((value) => value.trim().replace(/^#+/u, "").trim())
  .pipe(
    z
      .string()
      .min(1, "ハッシュタグを入力してください。")
      .max(
        HASHTAG_MAX_LENGTH,
        `ハッシュタグは${HASHTAG_MAX_LENGTH}文字以内で入力してください。`,
      )
      .refine(
        (value) =>
          !/[\s#]/u.test(value) &&
          !UNSAFE_DISPLAY_CHARACTER_PATTERN.test(value),
        "ハッシュタグに空白や記号は使えません。",
      ),
  );

const hashtagsSchema = z
  .array(hashtagSchema)
  .max(
    MAX_POST_HASHTAGS,
    `ハッシュタグは${MAX_POST_HASHTAGS}件までです。`,
  )
  .refine(
    // Two tags that differ only by case would render as one tag to a reader,
    // so they are the same tag here too.
    (tags) =>
      new Set(tags.map((tag) => tag.toLocaleLowerCase())).size === tags.length,
    "同じハッシュタグを重複して指定できません。",
  );

const oshiIdsSchema = z
  .array(postOshiIdSchema)
  .max(MAX_POST_OSHIS, `関連付けられる推しは${MAX_POST_OSHIS}人までです。`)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "同じ推しを重複して指定できません。",
  );

export const postImagePathSchema = z
  .string()
  .regex(scopedObjectPathPattern(), "画像の保存先が不正です。");

export const createPostSchema = z.object({
  groupId: postGroupIdSchema,
  body: postBodySchema,
  oshiIds: oshiIdsSchema,
  hashtags: hashtagsSchema,
});

export const updatePostSchema = z.object({
  postId: postIdSchema,
  body: postBodySchema,
  oshiIds: oshiIdsSchema,
  hashtags: hashtagsSchema,
});

export const deletePostSchema = z.object({
  postId: postIdSchema,
});

export function buildPostImagePath(input: {
  groupId: string;
  postId: string;
  extension: SupportedImageExtension;
  randomId: string;
}): string {
  const groupId = postGroupIdSchema.parse(input.groupId);
  const postId = postIdSchema.parse(input.postId);

  return postImagePathSchema.parse(
    `${groupId}/${postId}/${input.randomId}.${input.extension}`,
  );
}

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
