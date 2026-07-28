import { z } from "zod";

import { lowercaseUuid } from "@/lib/validation/identifiers";
import { postGroupIdSchema, postIdSchema } from "@/lib/validation/posts";
import {
  UNSAFE_BODY_CHARACTER_PATTERN,
  normalizeLineEndings,
} from "@/lib/validation/text";

export const REPLY_BODY_MAX_LENGTH = 1000;
export const SHARE_NOTE_MAX_LENGTH = 200;

export const replyIdSchema = lowercaseUuid("有効な返信を選択してください。");

export const replyBodySchema = z
  .string()
  .transform((value) => normalizeLineEndings(value).trim())
  .pipe(
    z
      .string()
      .min(1, "返信を入力してください。")
      .max(
        REPLY_BODY_MAX_LENGTH,
        `返信は${REPLY_BODY_MAX_LENGTH}文字以内で入力してください。`,
      )
      .refine(
        (value) => !UNSAFE_BODY_CHARACTER_PATTERN.test(value),
        "返信に使用できない文字が含まれています。",
      ),
  );

/**
 * A share may carry a note or nothing at all, and an empty field is nothing
 * rather than an error: the member pressed share, which is the whole intent.
 */
export const shareNoteSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) =>
    typeof value === "string" ? normalizeLineEndings(value).trim() : "",
  )
  .pipe(
    z
      .string()
      .max(
        SHARE_NOTE_MAX_LENGTH,
        `ひとことは${SHARE_NOTE_MAX_LENGTH}文字以内で入力してください。`,
      )
      .refine(
        (value) => !UNSAFE_BODY_CHARACTER_PATTERN.test(value),
        "ひとことに使用できない文字が含まれています。",
      ),
  )
  .transform((value) => (value.length > 0 ? value : null));

export const togglePostLikeSchema = z.object({
  groupId: postGroupIdSchema,
  postId: postIdSchema,
});

export const createReplySchema = z.object({
  groupId: postGroupIdSchema,
  postId: postIdSchema,
  body: replyBodySchema,
});

export const deleteReplySchema = z.object({
  groupId: postGroupIdSchema,
  replyId: replyIdSchema,
});

export const sharePostSchema = z.object({
  groupId: postGroupIdSchema,
  postId: postIdSchema,
  note: shareNoteSchema,
});

export const unsharePostSchema = togglePostLikeSchema;

export type CreateReplyInput = z.infer<typeof createReplySchema>;
export type SharePostInput = z.infer<typeof sharePostSchema>;
