import { sessionSecurityMethod } from "@/lib/auth/session-method";

export type InvitationSessionMode = "setup" | "manual";

export function invitationSessionMode(
  claims: unknown,
): InvitationSessionMode | null {
  const method = sessionSecurityMethod(claims);

  if (method === "invite") {
    return "setup";
  }

  if (method === "password") {
    return "manual";
  }

  return null;
}
