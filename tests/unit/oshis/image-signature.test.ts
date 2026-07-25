import { describe, expect, it } from "vitest";

import {
  MAX_OSHI_IMAGE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  detectImageFormat,
  inspectImageUpload,
} from "@/lib/media/image-signature";

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

function ascii(text: string) {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function concat(...parts: Uint8Array[]) {
  const total = parts.reduce((size, part) => size + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

const jpeg = concat(bytes(0xff, 0xd8, 0xff, 0xe0), new Uint8Array(64));
const png = concat(
  bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  new Uint8Array(64),
);
const webp = concat(
  ascii("RIFF"),
  bytes(0x40, 0x00, 0x00, 0x00),
  ascii("WEBP"),
  ascii("VP8 "),
  new Uint8Array(64),
);

describe("detectImageFormat", () => {
  it("recognises the three raster formats the app accepts", () => {
    expect(detectImageFormat(jpeg)).toBe("jpeg");
    expect(detectImageFormat(png)).toBe("png");
    expect(detectImageFormat(webp)).toBe("webp");
  });

  it("rejects SVG regardless of leading whitespace, BOM, or XML prologue", () => {
    const svgVariants = [
      "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
      "  \n\t<svg></svg>",
      "<?xml version='1.0'?><svg></svg>",
      `${String.fromCharCode(0xfeff)}<svg></svg>`,
      "<!DOCTYPE svg><svg></svg>",
    ];

    for (const variant of svgVariants) {
      expect(detectImageFormat(new TextEncoder().encode(variant))).toBeNull();
    }
  });

  it("rejects other container formats that browsers would happily render", () => {
    expect(detectImageFormat(ascii("GIF89a"))).toBeNull();
    expect(detectImageFormat(ascii("BM"))).toBeNull();
    expect(detectImageFormat(ascii("%PDF-1.7"))).toBeNull();
    expect(detectImageFormat(ascii("<!doctype html><script>"))).toBeNull();
    expect(detectImageFormat(bytes(0x00, 0x00, 0x01, 0x00))).toBeNull();
  });

  it("rejects a RIFF container that is not actually WebP", () => {
    const riffWave = concat(
      ascii("RIFF"),
      bytes(0x40, 0x00, 0x00, 0x00),
      ascii("WAVE"),
      new Uint8Array(64),
    );

    expect(detectImageFormat(riffWave)).toBeNull();
  });

  it("rejects buffers that are too short to carry a signature", () => {
    expect(detectImageFormat(new Uint8Array(0))).toBeNull();
    expect(detectImageFormat(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageFormat(ascii("RIFF"))).toBeNull();
  });
});

describe("inspectImageUpload", () => {
  it("accepts a matching declared type and returns the canonical content type", () => {
    expect(inspectImageUpload(jpeg, "image/jpeg")).toEqual({
      ok: true,
      format: "jpeg",
      contentType: "image/jpeg",
      extension: "jpg",
    });
    expect(inspectImageUpload(png, "image/png")).toEqual({
      ok: true,
      format: "png",
      contentType: "image/png",
      extension: "png",
    });
    expect(inspectImageUpload(webp, "image/webp")).toEqual({
      ok: true,
      format: "webp",
      contentType: "image/webp",
      extension: "webp",
    });
  });

  it("ignores client-supplied parameters and casing on the declared type", () => {
    expect(inspectImageUpload(png, "IMAGE/PNG; charset=binary")).toMatchObject({
      ok: true,
      format: "png",
    });
  });

  it("rejects a spoofed MIME type whose bytes are a different format", () => {
    expect(inspectImageUpload(png, "image/jpeg")).toEqual({
      ok: false,
      reason: "declared-mismatch",
    });
  });

  it("rejects SVG bytes even when the declared type is an accepted raster type", () => {
    const svg = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");

    expect(inspectImageUpload(svg, "image/png")).toEqual({
      ok: false,
      reason: "unsupported-format",
    });
  });

  it("rejects a declared type outside the allow list before sniffing", () => {
    expect(inspectImageUpload(jpeg, "image/svg+xml")).toEqual({
      ok: false,
      reason: "unsupported-type",
    });
    expect(inspectImageUpload(jpeg, "")).toEqual({
      ok: false,
      reason: "unsupported-type",
    });
    expect(inspectImageUpload(jpeg, "image/jpg")).toEqual({
      ok: false,
      reason: "unsupported-type",
    });
  });

  it("rejects empty and oversized buffers", () => {
    expect(inspectImageUpload(new Uint8Array(0), "image/png")).toEqual({
      ok: false,
      reason: "empty",
    });

    const oversized = concat(png, new Uint8Array(MAX_OSHI_IMAGE_BYTES));

    expect(inspectImageUpload(oversized, "image/png")).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("allows a caller to tighten, but never to loosen, the size ceiling", () => {
    expect(
      inspectImageUpload(png, "image/png", { maxBytes: 8 }),
    ).toEqual({ ok: false, reason: "too-large" });

    expect(
      inspectImageUpload(png, "image/png", {
        maxBytes: MAX_OSHI_IMAGE_BYTES * 10,
      }),
    ).toMatchObject({ ok: true });

    const oversized = concat(png, new Uint8Array(MAX_OSHI_IMAGE_BYTES));

    expect(
      inspectImageUpload(oversized, "image/png", {
        maxBytes: MAX_OSHI_IMAGE_BYTES * 10,
      }),
    ).toEqual({ ok: false, reason: "too-large" });
  });

  it("publishes an allow list that excludes every scriptable image type", () => {
    expect([...SUPPORTED_IMAGE_MIME_TYPES]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(MAX_OSHI_IMAGE_BYTES).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
});
