import { NextResponse } from "next/server";
import { createUser, listUsers } from "@/lib/auth/local-users";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { ensureDefaultUserSettings } from "@/lib/db/user-settings";

export async function POST(request: Request) {
  try {
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
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
