/**
 * Characters that must never reach a rendered surface.
 *
 * Beyond the C0 and C1 control ranges these cover the zero-width and
 * bidirectional overrides that let one piece of text impersonate another:
 * U+202E alone can make "gnp.exe" read as "exe.png". U+200D is deliberately
 * left out so emoji joiner sequences keep working.
 *
 * These mirror private.has_unsafe_display_characters in the migrations.
 */
const INVISIBLE_AND_BIDI = "\\u200b\\u200c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff";

/** For single-line values such as a display name: no breaks of any kind. */
export const UNSAFE_DISPLAY_CHARACTER_PATTERN = new RegExp(
  `[\\u0000-\\u001f\\u007f-\\u009f${INVISIBLE_AND_BIDI}]`,
  "u",
);

/** For written text, where line breaks and tabs are part of the content. */
export const UNSAFE_BODY_CHARACTER_PATTERN = new RegExp(
  `[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f${INVISIBLE_AND_BIDI}]`,
  "u",
);

/**
 * Form submissions arrive with CRLF line endings, so bodies are folded to LF
 * before they are measured or stored. Without this a post would be rejected
 * for a carriage return the member never typed.
 */
export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}
