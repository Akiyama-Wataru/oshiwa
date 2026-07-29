"use server";

import { revalidatePath } from "next/cache";

import {
  reportFailure,
  resolveServerClient,
} from "@/lib/supabase/action-support";
import { siteUrlSchemaForMode } from "@/lib/validation/groups";
import {
  createJoinLinkSchema,
  joinLinkPath,
  revokeJoinLinkSchema,
} from "@/lib/validation/join-links";

export type JoinLinkActionState = {
  status: "idle" | "success" | "error";
  message: string;
  /** Shown once, because the database only ever returns the token once. */
  linkUrl: string | null;
};

export type JoinLinkAction = (
  state: JoinLinkActionState,
  formData: FormData,
) => Promise<JoinLinkActionState>;

const SCOPE = "join-links";

const CREATE_ERROR =
  "参加リンクを作成できませんでした。権限を確認してもう一度お試しください。";
const REVOKE_ERROR =
  "参加リンクを取り消せませんでした。もう一度お試しください。";
const LOCAL_PREVIEW_ERROR =
  "ローカルプレビューでは参加リンクの発行が未設定です。";

function membersPath(groupId: string): string {
  return `/groups/${groupId}/members`;
}

function readToken(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const row = value[0];

  if (!row || typeof row !== "object") {
    return null;
  }

  const token = (row as Record<string, unknown>).link_token;

  return typeof token === "string" ? token : null;
}

export async function createJoinLinkAction(
  _state: JoinLinkActionState,
  formData: FormData,
): Promise<JoinLinkActionState> {
  const parsed = createJoinLinkSchema.safeParse({
    groupId: formData.get("groupId"),
    role: formData.get("role"),
    lifetimeHours: formData.get("lifetimeHours"),
  });

  if (!parsed.success) {
    return { status: "error", message: CREATE_ERROR, linkUrl: null };
  }

  const siteUrl = siteUrlSchemaForMode(process.env.NODE_ENV).safeParse(
    process.env.NEXT_PUBLIC_SITE_URL,
  );

  // Without the site's own address the link would be a bare token that nobody
  // can open, which is worse than saying it did not work.
  if (!siteUrl.success) {
    reportFailure(SCOPE, "site_url", "missing or invalid");
    return { status: "error", message: CREATE_ERROR, linkUrl: null };
  }

  const resolution = await resolveServerClient({
    fallbackMessage: CREATE_ERROR,
    localPreviewMessage: LOCAL_PREVIEW_ERROR,
  });

  if (!resolution.ok) {
    return { status: "error", message: resolution.message, linkUrl: null };
  }

  const { data, error } = await resolution.client.rpc(
    "create_group_join_link",
    {
      target_group_id: parsed.data.groupId,
      invited_role: parsed.data.role,
      expires_in: `${parsed.data.lifetimeHours} hours`,
    },
  );

  const token = readToken(data);

  if (error || !token) {
    reportFailure(SCOPE, "create_group_join_link", error ?? "refused");
    return { status: "error", message: CREATE_ERROR, linkUrl: null };
  }

  revalidatePath(membersPath(parsed.data.groupId));

  return {
    status: "success",
    message:
      "参加リンクを作成しました。最初に開いた人だけが参加でき、そこで無効になります。",
    linkUrl: `${siteUrl.data}${joinLinkPath(token)}`,
  };
}

export async function revokeJoinLinkAction(
  _state: JoinLinkActionState,
  formData: FormData,
): Promise<JoinLinkActionState> {
  const parsed = revokeJoinLinkSchema.safeParse({
    groupId: formData.get("groupId"),
    linkId: formData.get("linkId"),
  });

  if (!parsed.success) {
    return { status: "error", message: REVOKE_ERROR, linkUrl: null };
  }

  const resolution = await resolveServerClient({
    fallbackMessage: REVOKE_ERROR,
    localPreviewMessage: LOCAL_PREVIEW_ERROR,
  });

  if (!resolution.ok) {
    return { status: "error", message: resolution.message, linkUrl: null };
  }

  const { data, error } = await resolution.client.rpc(
    "revoke_group_join_link",
    { target_link_id: parsed.data.linkId },
  );

  if (error || data !== true) {
    reportFailure(SCOPE, "revoke_group_join_link", error ?? "refused");
    return { status: "error", message: REVOKE_ERROR, linkUrl: null };
  }

  revalidatePath(membersPath(parsed.data.groupId));

  return {
    status: "success",
    message: "参加リンクを取り消しました。",
    linkUrl: null,
  };
}
