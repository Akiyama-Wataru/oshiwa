/**
 * Binary signature checks for member uploads.
 *
 * The browser-supplied MIME type is attacker controlled, so every upload is
 * re-sniffed from its own bytes before it reaches Storage. Only the three
 * raster formats below are accepted; SVG is excluded on purpose because it is
 * a scriptable document, not an image.
 */

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export type SupportedImageFormat = "jpeg" | "png" | "webp";

export type SupportedImageExtension = "jpg" | "png" | "webp";

/** Hard ceiling applied after the client-side compression pass. */
export const MAX_OSHI_IMAGE_BYTES = 1024 * 1024;

export type ImageUploadRejection =
  | "empty"
  | "too-large"
  | "unsupported-type"
  | "unsupported-format"
  | "declared-mismatch";

export type ImageUploadInspection =
  | {
      ok: true;
      format: SupportedImageFormat;
      contentType: SupportedImageMimeType;
      extension: SupportedImageExtension;
    }
  | { ok: false; reason: ImageUploadRejection };

const FORMAT_CONTENT_TYPES: Record<
  SupportedImageFormat,
  SupportedImageMimeType
> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const FORMAT_EXTENSIONS: Record<
  SupportedImageFormat,
  SupportedImageExtension
> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];

/** Shortest buffer that can still carry the longest signature we check. */
const MINIMUM_SIGNATURE_BYTES = 12;

function matchesAt(
  bytes: Uint8Array,
  signature: readonly number[],
  offset: number,
): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export function detectImageFormat(
  bytes: Uint8Array,
): SupportedImageFormat | null {
  if (bytes.length < MINIMUM_SIGNATURE_BYTES) {
    return null;
  }

  if (matchesAt(bytes, PNG_SIGNATURE, 0)) {
    return "png";
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  if (
    matchesAt(bytes, RIFF_SIGNATURE, 0) &&
    matchesAt(bytes, WEBP_SIGNATURE, 8)
  ) {
    return "webp";
  }

  return null;
}

function normalizeDeclaredType(declaredType: string): string {
  return declaredType.split(";", 1)[0].trim().toLowerCase();
}

function isSupportedMimeType(value: string): value is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function inspectImageUpload(
  bytes: Uint8Array,
  declaredType: string,
  options: { maxBytes?: number } = {},
): ImageUploadInspection {
  // Checked first: a browser sends an unselected file field as a zero byte
  // entry typed application/octet-stream, and "choose a file" is the useful
  // answer there rather than "that format is unsupported".
  if (bytes.length === 0) {
    return { ok: false, reason: "empty" };
  }

  const normalizedType = normalizeDeclaredType(declaredType);

  if (!isSupportedMimeType(normalizedType)) {
    return { ok: false, reason: "unsupported-type" };
  }

  // A caller may tighten the ceiling for a specific surface, never raise it.
  const ceiling = Math.min(
    options.maxBytes ?? MAX_OSHI_IMAGE_BYTES,
    MAX_OSHI_IMAGE_BYTES,
  );

  if (bytes.length > ceiling) {
    return { ok: false, reason: "too-large" };
  }

  const format = detectImageFormat(bytes);

  if (!format) {
    return { ok: false, reason: "unsupported-format" };
  }

  if (FORMAT_CONTENT_TYPES[format] !== normalizedType) {
    return { ok: false, reason: "declared-mismatch" };
  }

  return {
    ok: true,
    format,
    contentType: FORMAT_CONTENT_TYPES[format],
    extension: FORMAT_EXTENSIONS[format],
  };
}
