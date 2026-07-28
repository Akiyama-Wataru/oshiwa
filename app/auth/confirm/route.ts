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
const RECOVERY_FAILURE = "/password/reset?status=link-expired";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const type = requestUrl.searchParams.get("type");
  const tokenHash = inviteTokenSchema.safeParse(
    requestUrl.searchParams.get("token_hash"),
  );

  if ((type !== "invite" && type !== "recovery") || !tokenHash.success) {
    return redirectResponse(request, INVITE_FAILURE);
  }

  const isRecovery = type === "recovery";
  const failure = isRecovery ? RECOVERY_FAILURE : INVITE_FAILURE;
  // A recovery link is only ever on its way to the form that sets the new
  // password, so its destination is fixed rather than read from the query.
  const destination = isRecovery
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
