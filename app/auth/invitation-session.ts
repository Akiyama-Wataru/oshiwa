export type InvitationSessionMode = "setup" | "manual";

export function invitationSessionMode(
  claims: unknown,
): InvitationSessionMode | null {
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

  if (securityMethods.length !== 1) {
    return null;
  }

  if (securityMethods[0] === "invite") {
    return "setup";
  }

  if (securityMethods[0] === "password") {
    return "manual";
  }

  return null;
}
