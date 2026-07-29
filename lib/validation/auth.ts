import { z } from "zod";

import { UNSAFE_DISPLAY_CHARACTER_PATTERN } from "@/lib/validation/text";

const passwordSchema = z
  .string()
  .min(12, "パスワードは12文字以上で入力してください。")
  .max(128, "パスワードは128文字以内で入力してください。");

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("有効なメールアドレスを入力してください。")),
  password: passwordSchema,
});

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "表示名を入力してください。")
  .max(40, "表示名は40文字以内で入力してください。")
  .refine(
    (value) => !UNSAFE_DISPLAY_CHARACTER_PATTERN.test(value),
    "表示名に使用できない文字が含まれています。",
  );

export const signupSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("有効なメールアドレスを入力してください。")),
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const setPasswordSchema = z.object({
  password: passwordSchema,
});

export const resetRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("有効なメールアドレスを入力してください。")),
});

export const inviteTokenSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-f0-9]{64}$/,
    "招待トークンは64文字の16進数である必要があります。",
  );

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
