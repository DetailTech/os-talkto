import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { clearCookieOptions } from "@/lib/security/cookie-options";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", clearCookieOptions());
  return response;
}
