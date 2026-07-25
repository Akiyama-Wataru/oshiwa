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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const type = requestUrl.searchParams.get("type");
  const tokenHash = inviteTokenSchema.safeParse(
    requestUrl.searchParams.get("token_hash"),
  );

  if (type !== "invite" || !tokenHash.success) {
    return redirectResponse(request, "/login?status=confirmation-failed");
  }

  const destination = confirmationDestination(
    requestUrl,
    requestUrl.searchParams.get("next"),
  );

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      type: "invite",
      token_hash: tokenHash.data,
    });

    if (error) {
      return redirectResponse(request, "/login?status=confirmation-failed");
    }
  } catch {
    return redirectResponse(request, "/login?status=confirmation-failed");
  }

  return redirectResponse(request, destination);
}
