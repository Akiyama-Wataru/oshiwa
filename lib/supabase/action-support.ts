import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseConfigurationError } from "@/lib/env";
import type { ImageUploadRejection } from "@/lib/media/image-signature";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The plumbing every feature's server actions repeat: resolving a client,
 * recording why something failed, and cleaning up objects the database no
 * longer refers to. It lives outside the "use server" modules because those
 * may only export async functions.
 */

export type ActionClientResolution =
  | { ok: true; client: SupabaseClient }
  | { ok: false; message: string };

/**
 * The messages returned to members are deliberately generic, so the cause has
 * to be recorded somewhere. This writes the operation and the database or
 * storage error, never the caller's data.
 */
export function reportFailure(
  scope: string,
  operation: string,
  cause: unknown,
): void {
  const detail =
    cause && typeof cause === "object" && "message" in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  console.error(`[${scope}] ${operation} failed: ${detail}`);
}

export async function resolveServerClient(options: {
  fallbackMessage: string;
  localPreviewMessage: string;
}): Promise<ActionClientResolution> {
  try {
    return { ok: true, client: await createServerSupabaseClient() };
  } catch (error) {
    if (
      error instanceof SupabaseConfigurationError &&
      process.env.NODE_ENV !== "production"
    ) {
      return { ok: false, message: options.localPreviewMessage };
    }

    return { ok: false, message: options.fallbackMessage };
  }
}

/**
 * Storage cleanup runs with the service role because the caller has already
 * been authorized by the RPC that handed back the stale object path, and a
 * plain member is not allowed to delete objects directly.
 */
export async function removeStorageObjects(
  scope: string,
  bucket: string,
  paths: readonly string[],
): Promise<boolean> {
  if (paths.length === 0) {
    return true;
  }

  try {
    const admin = createAdminSupabaseClient();
    const { error } = await admin.storage.from(bucket).remove([...paths]);

    if (error) {
      reportFailure(scope, "storage.remove", error);
    }

    return !error;
  } catch (cause) {
    reportFailure(scope, "storage.remove", cause);
    return false;
  }
}

/**
 * A mismatch between the declared type and the bytes is almost always an
 * attack, so it gets the same neutral copy as an unsupported format.
 */
export const IMAGE_REJECTION_MESSAGES: Record<ImageUploadRejection, string> = {
  empty: "画像ファイルを選択してください。",
  "too-large": "画像は1MB以下に圧縮してから登録してください。",
  "unsupported-type": "画像はJPEG・PNG・WebPのみ登録できます。",
  "unsupported-format": "画像はJPEG・PNG・WebPのみ登録できます。",
  "declared-mismatch": "画像はJPEG・PNG・WebPのみ登録できます。",
};
