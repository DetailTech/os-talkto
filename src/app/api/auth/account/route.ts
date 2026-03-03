import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { deleteUser } from "@/lib/auth/local-users";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { deleteOracleUserData } from "@/lib/db/oracle";

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await deleteOracleUserData(user.id);
    await deleteUser(user.id);

    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete account";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
