import { z } from "zod";

export const groupIdSchema = z.uuid("有効なグループを選択してください。");

export const groupNameSchema = z
  .string()
  .trim()
  .min(1, "グループ名を入力してください。")
  .max(100, "グループ名は100文字以内で入力してください。");

export const membershipRoleSchema = z.enum(["member", "admin"]);

export const createGroupSchema = z.object({
  name: groupNameSchema,
});

export const createInvitationSchema = z.object({
  groupId: groupIdSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("有効なメールアドレスを入力してください。")),
  role: membershipRoleSchema,
});

export const siteUrlSchema = z
  .url("有効なサイトURLを設定してください。")
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === ""
    );
  }, "サイトURLにはHTTP(S)のoriginだけを指定してください。")
  .transform((value) => new URL(value).origin);

export function siteUrlSchemaForMode(
  mode: "development" | "production" | "test",
) {
  return siteUrlSchema.refine(
    (origin) =>
      mode !== "production" || new URL(origin).protocol === "https:",
    "本番環境のサイトURLにはHTTPSが必要です。",
  );
}

export type MembershipRole = z.infer<typeof membershipRoleSchema>;
