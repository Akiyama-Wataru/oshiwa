import { NextResponse } from "next/server";

import { safeReturnTo } from "@/lib/auth/redirect";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inviteTokenSchema } from "@/lib/validation/auth";

const NO_STORE = "private, no-store, max-age=0";

function redirectResponse(request: Request, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", NO_STORE);
  return response;
}

function confirmationDestination(requestUrl: URL, value: string | null) {
  if (value) {
    try {
      const isRelative = value.startsWith("/") && !value.startsWith("//");
      const parsed = new URL(value, requestUrl);
      const token = parsed.pathname.match(/^\/join\/([^/]+)$/u)?.[1];

      if (
        (isRelative || parsed.href === value) &&
        parsed.origin === requestUrl.origin &&
        parsed.username === "" &&
        parsed.password === "" &&
        token &&
        inviteTokenSchema.safeParse(token).success
      ) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      // The generic safe return path below handles malformed values.
    }
  }

  return safeReturnTo(value, "/groups");
}

/** Where a link of each kind is allowed to be on its way to. */
const RECOVERY_DESTINATION = "/password/update";
const INVITE_FAILURE = "/login?status=confirmation-failed";
const SIGNUP_FAILURE = "/login?status=signup-confirmation-failed";
const RECOVERY_FAILURE = "/password/reset?status=link-expired";

/**
 * The three kinds of link this route is on the receiving end of. A sign up
 * confirmation is one of them now that anybody can register: without it, a new
 * member who did everything right would be told their link was no good.
 */
const CONFIRMATION_TYPES = ["invite", "recovery", "signup"] as const;

type ConfirmationType = (typeof CONFIRMATION_TYPES)[number];

function readType(value: string | null): ConfirmationType | null {
  return CONFIRMATION_TYPES.includes(value as ConfirmationType)
    ? (value as ConfirmationType)
    : null;
}

const FAILURES: Record<ConfirmationType, string> = {
  invite: INVITE_FAILURE,
  recovery: RECOVERY_FAILURE,
  signup: SIGNUP_FAILURE,
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const type = readType(requestUrl.searchParams.get("type"));
  const tokenHash = inviteTokenSchema.safeParse(
    requestUrl.searchParams.get("token_hash"),
  );

  if (type === null || !tokenHash.success) {
    return redirectResponse(request, INVITE_FAILURE);
  }

  const failure = FAILURES[type];
  // A recovery link is only ever on its way to the form that sets the new
  // password, so its destination is fixed rather than read from the query.
  const destination =
    type === "recovery"
      ? RECOVERY_DESTINATION
      : confirmationDestination(requestUrl, requestUrl.searchParams.get("next"));

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash.data,
    });

    if (error) {
      return redirectResponse(request, failure);
    }
  } catch {
    return redirectResponse(request, failure);
  }

  return redirectResponse(request, destination);
}
