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

function readOrigin(value: string): URL | null {
  // Refinements still run after `url()` has already rejected a value, so this
  // has to answer rather than throw: an unset NEXT_PUBLIC_SITE_URL would
  // otherwise crash the caller instead of failing validation.
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export const siteUrlSchema = z
  .url("有効なサイトURLを設定してください。")
  .refine((value) => {
    const url = readOrigin(value);

    return (
      url !== null &&
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
      mode !== "production" || readOrigin(origin)?.protocol === "https:",
    "本番環境のサイトURLにはHTTPSが必要です。",
  );
}

export type MembershipRole = z.infer<typeof membershipRoleSchema>;
