import { z } from "zod";

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
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
