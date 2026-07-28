/**
 * How a session was established, read from the `amr` claim.
 *
 * The claim is the only trustworthy answer: a page cannot tell an invite link
 * from a typed password by looking at the user row, and a query string saying
 * which one it was would be written by whoever sent the request.
 *
 * A session carrying more than one security method is treated as unknown
 * rather than as the stronger or the weaker of the two, because there is no
 * safe way to guess which one the caller is relying on. Token refreshes are
 * ignored: they do not establish anything, they only extend it.
 */
export function sessionSecurityMethod(claims: unknown): string | null {
  if (!claims || typeof claims !== "object") {
    return null;
  }

  const amr = (claims as Record<string, unknown>).amr;

  if (!Array.isArray(amr) || amr.length === 0) {
    return null;
  }

  const methods: string[] = [];

  for (const entry of amr) {
    if (typeof entry === "string") {
      methods.push(entry);
      continue;
    }

    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).method === "string"
    ) {
      methods.push((entry as Record<string, string>).method);
      continue;
    }

    return null;
  }

  const securityMethods = [
    ...new Set(methods.filter((method) => method !== "token_refresh")),
  ];

  return securityMethods.length === 1 ? securityMethods[0] : null;
}

/**
 * True when the session came from a link this app just verified rather than
 * from a password somebody typed.
 *
 * The test is deliberately "not a password" rather than a list of the method
 * names Supabase uses for its emailed links: a name this app has not heard of
 * still cannot have been established by a password, and a reset flow that
 * breaks whenever that vocabulary grows would lock out exactly the people who
 * have no other way in.
 */
export function isLinkEstablishedSession(claims: unknown): boolean {
  const method = sessionSecurityMethod(claims);

  return method !== null && method !== "password";
}
