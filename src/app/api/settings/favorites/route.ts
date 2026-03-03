import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { saveOracleFavoritePersonas } from "@/lib/db/oracle";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { favorites } = await request.json();
  if (!Array.isArray(favorites)) {
    return NextResponse.json({ error: "favorites must be an array" }, { status: 400 });
  }

  await saveOracleFavoritePersonas(user.id, favorites.map((v) => String(v)));
  return NextResponse.json({ success: true });
}
