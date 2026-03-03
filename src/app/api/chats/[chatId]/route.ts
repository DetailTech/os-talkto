import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import {
  deleteOracleChat,
  getOracleChatById,
  updateOracleChatTitle,
} from "@/lib/db/oracle";

async function ensureOwnership(chatId: string, userId: string) {
  const chat = await getOracleChatById(chatId);
  return !!chat && chat.user_id === userId;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await params;
  const { title } = await request.json();
  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const owns = await ensureOwnership(chatId, user.id);
  if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await updateOracleChatTitle(chatId, title);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await params;
  const owns = await ensureOwnership(chatId, user.id);
  if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await deleteOracleChat(chatId);
  return NextResponse.json({ success: true });
}
