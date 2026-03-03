import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import {
  createOracleChat,
  listOracleChatParticipants,
  listOracleChatsByUser,
} from "@/lib/db/oracle";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const chats = await listOracleChatsByUser(user.id);
  const enriched = await Promise.all(
    chats.map(async (chat) => ({
      ...chat,
      participants: await listOracleChatParticipants(chat.id),
    }))
  );
  return NextResponse.json({ chats: enriched });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { personaId, personaIds, title } = (await request.json()) as {
    personaId?: string;
    personaIds?: string[];
    title?: string;
  };
  const selected = (personaIds || []).filter(Boolean);
  const finalPersonaId = personaId || selected[0];
  if (!finalPersonaId) {
    return NextResponse.json(
      { error: "personaId or personaIds is required" },
      { status: 400 }
    );
  }

  const chat = await createOracleChat({
    userId: user.id,
    personaId: finalPersonaId,
    personaIds: selected.length > 0 ? selected : [finalPersonaId],
    title: title || "New Chat",
  });
  const participants = await listOracleChatParticipants(chat.id);
  return NextResponse.json({ chat: { ...chat, participants } });
}
