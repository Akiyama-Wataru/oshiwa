const LOCAL_ORIGIN = "https://return-to.invalid";
const DEFAULT_RETURN_TO = "/groups";
const AUTH_ENTRY_PATHS = ["/login", "/signup", "/auth", "/password"];
const INVITATION_CONTINUATION_PATH = /^\/join\/[a-f0-9]{64}$/u;

function normalizeSafePath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2048 ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /%(?:2f|5c)/iu.test(value) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, LOCAL_ORIGIN);
    if (parsed.origin !== LOCAL_ORIGIN) {
      return null;
    }

    const isJoinPath =
      parsed.pathname === "/join" ||
      parsed.pathname.startsWith("/join/");
    if (
      (isJoinPath &&
        !INVITATION_CONTINUATION_PATH.test(parsed.pathname)) ||
      AUTH_ENTRY_PATHS.some(
        (path) =>
          parsed.pathname === path ||
          parsed.pathname.startsWith(`${path}/`),
      )
    ) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function safeReturnTo(
  value: unknown,
  fallback = DEFAULT_RETURN_TO,
): string {
  return (
    normalizeSafePath(value) ??
    normalizeSafePath(fallback) ??
    DEFAULT_RETURN_TO
  );
}
