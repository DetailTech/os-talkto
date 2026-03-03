import { NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth/local-users";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { sessionCookieOptions } from "@/lib/security/cookie-options";
import { getClientIp } from "@/lib/security/http";
import { checkRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const ipLimit = checkRateLimit({
      key: `auth:login:ip:${ip}`,
      windowMs: 60_000,
      maxRequests: 20,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
        }
      );
    }

    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const accountLimit = checkRateLimit({
      key: `auth:login:account:${String(email).toLowerCase()}`,
      windowMs: 60_000,
      maxRequests: 10,
    });
    if (!accountLimit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(accountLimit.retryAfterSeconds) },
        }
      );
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = createSessionToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(60 * 60 * 24 * 7));

    return response;
  } catch (error) {
    console.error("Login API error", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
