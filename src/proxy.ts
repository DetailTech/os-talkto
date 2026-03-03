import { NextResponse, type NextRequest } from "next/server";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function sameOrigin(request: NextRequest): boolean {
  const expected = request.nextUrl.origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  // Non-browser clients may omit both headers.
  return true;
}

function applySecurityHeaders(request: NextRequest, response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()"
  );
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (requestIsHttps(request)) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

function requestIsHttps(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  return proto === "https" || request.nextUrl.protocol === "https:";
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith("/api/") &&
    STATE_CHANGING_METHODS.has(request.method.toUpperCase()) &&
    !sameOrigin(request)
  ) {
    return applySecurityHeaders(
      request,
      NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 })
    );
  }

  const response = NextResponse.next({
    request,
  });
  return applySecurityHeaders(request, response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
