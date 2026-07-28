import { compressOshiImage } from "@/lib/media/compress-oshi-image";

export type ImagePreparer = (file: File) => Promise<File>;

/**
 * Returns a copy of the submission with every selected photo replaced by its
 * compressed, metadata-stripped counterpart. The original FormData is left
 * untouched so a retry can start from the same input, and repeated entries are
 * appended rather than collapsed so a post keeps all four of its photos.
 */
export async function withCompressedImages(
  formData: FormData,
  prepare: ImagePreparer = compressOshiImage,
): Promise<FormData> {
  const prepared = new FormData();

  for (const [key, value] of formData.entries()) {
    if (key === "image" && value instanceof File && value.size > 0) {
      prepared.append(key, await prepare(value));
      continue;
    }

    prepared.append(key, value);
  }

  return prepared;
}
