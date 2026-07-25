import imageCompression from "browser-image-compression";

import {
  MAX_OSHI_IMAGE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "@/lib/media/image-signature";

export type ImageCompressor = (
  file: File,
  options: Record<string, unknown>,
) => Promise<Blob>;

const COMPRESSED_FILE_NAME = "oshi-image";

function supportedType(candidate: string, fallback: string): string {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(candidate)
    ? candidate
    : fallback;
}

/**
 * Shrinks a member photo before it leaves the device. Re-encoding also drops
 * EXIF metadata such as GPS coordinates, and the original file name is
 * replaced so nothing personal rides along to Storage.
 *
 * Compression is an optimisation, never a security boundary: the server sniffs
 * the bytes again before anything is written.
 */
export async function compressOshiImage(
  file: File,
  compress: ImageCompressor = imageCompression as unknown as ImageCompressor,
): Promise<File> {
  try {
    const compressed = await compress(file, {
      maxSizeMB: MAX_OSHI_IMAGE_BYTES / (1024 * 1024),
      maxWidthOrHeight: 1280,
      useWebWorker: true,
      fileType: "image/webp",
    });

    const type = supportedType(compressed.type, file.type);

    return new File([compressed], COMPRESSED_FILE_NAME, { type });
  } catch {
    return file;
  }
}
