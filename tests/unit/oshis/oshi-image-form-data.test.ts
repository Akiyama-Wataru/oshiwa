import { describe, expect, it, vi } from "vitest";

import { compressOshiImage } from "@/lib/media/compress-oshi-image";
import { withCompressedImage } from "@/lib/media/oshi-image-form-data";

const oshiId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";

function submission(image?: File) {
  const formData = new FormData();
  formData.set("groupId", "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd");
  formData.set("oshiId", oshiId);

  if (image) {
    formData.set("image", image);
  }

  return formData;
}

describe("withCompressedImage", () => {
  it("replaces the photo and keeps every other field", async () => {
    const original = new File([new Uint8Array(4096)], "IMG_0042_home.jpg", {
      type: "image/jpeg",
    });
    const compressed = new File([new Uint8Array(64)], "oshi-image", {
      type: "image/webp",
    });
    const prepare = vi.fn(async () => compressed);

    const prepared = await withCompressedImage(submission(original), prepare);

    expect(prepare).toHaveBeenCalledWith(original);
    expect(prepared.get("image")).toBe(compressed);
    expect(prepared.get("oshiId")).toBe(oshiId);
  });

  it("never mutates the submission it was handed", async () => {
    const original = new File([new Uint8Array(8)], "a.png", {
      type: "image/png",
    });
    const formData = submission(original);

    await withCompressedImage(formData, async () =>
      new File([new Uint8Array(1)], "b", { type: "image/webp" }),
    );

    expect(formData.get("image")).toBe(original);
  });

  it("leaves an empty or missing selection to the server to reject", async () => {
    const prepare = vi.fn();
    const empty = new File([], "a.png", { type: "image/png" });

    expect((await withCompressedImage(submission(), prepare)).get("image")).toBeNull();
    expect(
      ((await withCompressedImage(submission(empty), prepare)).get(
        "image",
      ) as File).size,
    ).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("compressOshiImage", () => {
  const original = new File([new Uint8Array(4096)], "IMG_0042_home.jpg", {
    type: "image/jpeg",
  });

  it("asks for a webp within the upload ceiling and drops the file name", async () => {
    const compress = vi.fn(async () =>
      new Blob([new Uint8Array(128)], { type: "image/webp" }),
    );

    const result = await compressOshiImage(original, compress);

    expect(compress).toHaveBeenCalledWith(
      original,
      expect.objectContaining({ fileType: "image/webp", maxSizeMB: 1 }),
    );
    expect(result.type).toBe("image/webp");
    expect(result.size).toBe(128);
    expect(result.name).not.toContain("IMG_0042_home");
  });

  it("keeps the declared type honest when the compressor returns something else", async () => {
    const compress = vi.fn(async () => new Blob([new Uint8Array(8)]));

    expect((await compressOshiImage(original, compress)).type).toBe(
      "image/jpeg",
    );
  });

  it("falls back to the original file when compression throws", async () => {
    const compress = vi.fn(async () => {
      throw new Error("canvas unavailable");
    });

    expect(await compressOshiImage(original, compress)).toBe(original);
  });
});
