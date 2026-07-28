import { z } from "zod";

/**
 * PostgreSQL renders uuids in lowercase and storage object paths are matched
 * against that rendering, so lowercase is the canonical form everywhere.
 */
export function lowercaseUuid(message: string) {
  return z.uuid(message).transform((value) => value.toLowerCase());
}

export const UUID_PATTERN_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * `<group id>/<owner id>/<32 hex>.<extension>`: every segment is derived from
 * identifiers the database re-verifies, and the last one is opaque so a member
 * cannot guess another member's object name.
 */
export function scopedObjectPathPattern(): RegExp {
  return new RegExp(
    `^${UUID_PATTERN_SOURCE}/${UUID_PATTERN_SOURCE}/[0-9a-f]{32}\\.(?:jpg|png|webp)$`,
  );
}

/** 32 lowercase hex characters, matching the object-name segment above. */
export function createObjectId(
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  return randomUuid().replaceAll("-", "").toLowerCase();
}
