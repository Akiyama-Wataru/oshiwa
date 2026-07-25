import { normalizeMemberColor } from "@/lib/oshis/member-color";
import { oshiImagePathSchema } from "@/lib/validation/oshis";

export type OshiBoardEntry = {
  id: string;
  name: string;
  color: string;
  imagePath: string | null;
  imageUrl: string | null;
  canManage: boolean;
};

export type SignedObject = {
  path?: string | null;
  signedUrl?: string | null;
  error?: unknown;
};

const FALLBACK_COLOR = "#8d99ae";

/**
 * Rows arrive from PostgREST as unknown JSON. Anything that does not match the
 * shape the database guarantees is dropped rather than rendered, so a partially
 * migrated table can never inject an unexpected value into the markup.
 */
export function normalizeOshiRows(
  value: unknown,
  viewer: { userId: string; isManager: boolean },
): OshiBoardEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }

    const oshi = row as Record<string, unknown>;

    if (typeof oshi.id !== "string" || typeof oshi.name !== "string") {
      return [];
    }

    const imagePath =
      typeof oshi.image_path === "string" &&
      oshiImagePathSchema.safeParse(oshi.image_path).success
        ? oshi.image_path
        : null;

    return [
      {
        id: oshi.id,
        name: oshi.name,
        color:
          (typeof oshi.member_color === "string"
            ? normalizeMemberColor(oshi.member_color)
            : null) ?? FALLBACK_COLOR,
        imagePath,
        imageUrl: null,
        canManage: viewer.isManager || oshi.created_by === viewer.userId,
      },
    ];
  });
}

export function collectImagePaths(entries: readonly OshiBoardEntry[]): string[] {
  return entries.flatMap((entry) => (entry.imagePath ? [entry.imagePath] : []));
}

export function applySignedUrls(
  entries: readonly OshiBoardEntry[],
  signedObjects: readonly SignedObject[] | null | undefined,
): OshiBoardEntry[] {
  const urlsByPath = new Map(
    (signedObjects ?? []).flatMap((object) =>
      !object.error &&
      typeof object.path === "string" &&
      typeof object.signedUrl === "string"
        ? [[object.path, object.signedUrl] as const]
        : [],
    ),
  );

  return entries.map((entry) => ({
    ...entry,
    imageUrl: entry.imagePath ? (urlsByPath.get(entry.imagePath) ?? null) : null,
  }));
}
