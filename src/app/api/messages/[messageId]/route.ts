import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import {
  deleteOracleMessage,
  getOracleChatById,
  getOracleMessageById,
} from "@/lib/db/oracle";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { messageId } = await params;
  const message = await getOracleMessageById(messageId);

  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const chat = await getOracleChatById(message.chat_id);
  if (!chat || chat.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await deleteOracleMessage(messageId);
  return NextResponse.json({ success: true });
}
