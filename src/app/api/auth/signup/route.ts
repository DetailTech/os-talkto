import { NextResponse } from "next/server";
import { createUser, listUsers } from "@/lib/auth/local-users";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { ensureDefaultUserSettings } from "@/lib/db/user-settings";
import { sessionCookieOptions } from "@/lib/security/cookie-options";
import { getClientIp } from "@/lib/security/http";
import { checkRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  try {
    const allowSignup = (process.env.ALLOW_SIGNUP || "").toLowerCase() === "true";
    if (!allowSignup) {
      return NextResponse.json({ error: "Signup is disabled" }, { status: 403 });
    }

    const ip = getClientIp(request);
    const signupLimit = checkRateLimit({
      key: `auth:signup:ip:${ip}`,
      windowMs: 60_000,
      maxRequests: 8,
    });
    if (!signupLimit.allowed) {
      return NextResponse.json(
        { error: "Too many signup attempts. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(signupLimit.retryAfterSeconds) },
        }
      );
    }

    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existingUsers = await listUsers();
    const role = existingUsers.length === 0 ? "admin" : "user";
    const user = await createUser({ email, password, role });
    await ensureDefaultUserSettings(user.id);

    const token = createSessionToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const response = NextResponse.json({ success: true, role: user.role });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(60 * 60 * 24 * 7));

    return response;
  } catch (error) {
    console.error("Signup API error", error);
    return NextResponse.json({ error: "Signup failed" }, { status: 500 });
  }
}
