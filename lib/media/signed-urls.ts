/**
 * Storage hands back one entry per requested path, and a single expired or
 * rejected object arrives with an `error` beside a url that will not load.
 * Every caller has to drop those the same way, so the filtering lives here.
 */
export type SignedObject = {
  path?: string | null;
  signedUrl?: string | null;
  error?: unknown;
};

export function signedUrlsByPath(
  signedObjects: readonly SignedObject[] | null | undefined,
): Map<string, string> {
  return new Map(
    (signedObjects ?? []).flatMap((object) =>
      !object.error &&
      typeof object.path === "string" &&
      typeof object.signedUrl === "string"
        ? [[object.path, object.signedUrl] as const]
        : [],
    ),
  );
}
