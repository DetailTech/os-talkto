import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { updateUserPassword } from "@/lib/auth/local-users";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { password } = await request.json();
  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  await updateUserPassword(user.id, password);
  return NextResponse.json({ success: true });
}
