import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import {
  createOracleMessage,
  getOracleChatById,
  listOracleMessagesByChat,
} from "@/lib/db/oracle";

async function ensureOwnership(chatId: string, userId: string) {
  const chat = await getOracleChatById(chatId);
  return !!chat && chat.user_id === userId;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await params;
  const owns = await ensureOwnership(chatId, user.id);
  if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const messages = await listOracleMessagesByChat(chatId);
  return NextResponse.json({ messages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await params;
  const { role, content } = await request.json();
  if (!role || !content) {
    return NextResponse.json({ error: "role and content are required" }, { status: 400 });
  }

  const owns = await ensureOwnership(chatId, user.id);
  if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const message = await createOracleMessage({ chatId, role, content });
  return NextResponse.json({ message });
}
