import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { getAuthConfig } from "@/lib/auth/config";

export async function GET() {
  const config = await getAuthConfig();
  const user = await getCurrentUser();

  return NextResponse.json({
    authMode: config.mode,
    user: user
      ? {
          id: user.id,
          email: user.email,
          role: user.role,
        }
      : null,
  });
}
