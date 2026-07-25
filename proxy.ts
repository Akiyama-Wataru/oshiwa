import {
  createServerClient,
  type CookieMethodsServer,
  type CookieOptions,
} from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  type AppMode,
  resolveSupabaseEnv,
} from "@/lib/env";
import { safeReturnTo } from "@/lib/auth/return-to";

type ClaimsResult = {
  data: { claims: unknown | null } | null;
  error: unknown;
};

type ProxySupabaseClient = {
  auth: {
    getClaims(): Promise<ClaimsResult>;
  };
};

type ProxyClientFactory = (
  url: string,
  publishableKey: string,
  options: { cookies: CookieMethodsServer },
) => ProxySupabaseClient;

export type AuthProxyDependencies = {
  createClient?: ProxyClientFactory;
  createNonce?: () => string;
  env?: Record<string, string | undefined>;
  mode?: AppMode;
};

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

const CONTENT_SECURITY_POLICY = "Content-Security-Policy";
const PRIVATE_NO_STORE =
  "private, no-cache, no-store, must-revalidate, max-age=0";

function runtimePublicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

function buildContentSecurityPolicy(
  nonce: string,
  supabaseUrl: string | null,
): string {
  const connectSources = ["'self'"];
  const imageSources = ["'self'", "data:", "blob:"];

  if (supabaseUrl) {
    const origin = new URL(supabaseUrl).origin;
    const websocketOrigin = origin.replace(/^http/u, "ws");
    connectSources.push(origin, websocketOrigin);
    imageSources.push(origin);
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join("; ");
}

function applyResponseSecurity(
  response: NextResponse,
  csp: string,
  isProtected: boolean,
): void {
  response.headers.set(CONTENT_SECURITY_POLICY, csp);
  response.headers.set("Referrer-Policy", "no-referrer");

  if (isProtected) {
    response.headers.set("Cache-Control", PRIVATE_NO_STORE);
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }
}

function applyCookies(
  response: NextResponse,
  pendingCookies: PendingCookie[],
): void {
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
}

export function isAuthProxyPath(pathname: string): boolean {
  return pathname === "/groups" || pathname.startsWith("/groups/");
}

function isPrivateResponsePath(pathname: string): boolean {
  return (
    isAuthProxyPath(pathname) ||
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/join/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/")
  );
}

export async function handleAuthProxy(
  request: NextRequest,
  dependencies: AuthProxyDependencies = {},
): Promise<NextResponse> {
  const mode = dependencies.mode ?? process.env.NODE_ENV;
  const env = dependencies.env ?? runtimePublicEnv();
  const hasSupabaseUrl =
    (env.NEXT_PUBLIC_SUPABASE_URL?.trim().length ?? 0) > 0;
  const hasPublishableKey =
    (
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim().length ??
      0
    ) > 0;
  const supabase = resolveSupabaseEnv(
    env,
    mode === "production" && !hasSupabaseUrl && !hasPublishableKey
      ? "test"
      : mode,
  );
  const nonce = (dependencies.createNonce ?? (() => crypto.randomUUID()))();
  const csp = buildContentSecurityPolicy(
    nonce,
    supabase.configured ? supabase.url : null,
  );
  const isProtected = isAuthProxyPath(request.nextUrl.pathname);
  const isPrivate = isPrivateResponsePath(request.nextUrl.pathname);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CONTENT_SECURITY_POLICY, csp);
  const pendingCookies: PendingCookie[] = [];

  const buildNextResponse = () => {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    applyCookies(response, pendingCookies);
    applyResponseSecurity(response, csp, isPrivate);
    return response;
  };

  const buildLoginRedirect = () => {
    const destination = new URL("/login", request.url);
    destination.searchParams.set(
      "returnTo",
      safeReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`),
    );
    const response = NextResponse.redirect(destination);
    applyCookies(response, pendingCookies);
    applyResponseSecurity(response, csp, true);
    return response;
  };

  if (!isProtected) {
    return buildNextResponse();
  }

  if (!supabase.configured) {
    return buildLoginRedirect();
  }

  const factory =
    dependencies.createClient ??
    ((url, key, options) => createServerClient(url, key, options));

  const client = factory(supabase.url, supabase.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map(({ name, value }) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          pendingCookies.push(cookie);
        }
        requestHeaders.set("cookie", request.cookies.toString());
      },
    },
  });

  try {
    const { data, error } = await client.auth.getClaims();
    if (error || !data?.claims) {
      return buildLoginRedirect();
    }
  } catch {
    return buildLoginRedirect();
  }

  return buildNextResponse();
}

export function proxy(request: NextRequest): Promise<NextResponse> {
  return handleAuthProxy(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|offline.css|offline.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
