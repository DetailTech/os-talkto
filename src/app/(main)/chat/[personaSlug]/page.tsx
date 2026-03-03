import { redirect } from "next/navigation";
import { ChatInterface } from "@/components/chat/chat-interface";
import type { Message } from "@/types/database";
import { requireUser } from "@/lib/auth/server";
import {
  getOracleChatById,
  getOraclePersonaBySlug,
  getOracleUserSettings,
  listOracleChatsByPersona,
  listOracleMessagesByChat,
} from "@/lib/db/oracle";

export const dynamic = "force-dynamic";

interface ChatPageProps {
  params: Promise<{ personaSlug: string }>;
  searchParams: Promise<{ chat?: string }>;
}

export default async function ChatPage({ params, searchParams }: ChatPageProps) {
  const { personaSlug } = await params;
  const { chat: chatId } = await searchParams;
  const user = await requireUser();

  // Fetch persona
  const persona = await getOraclePersonaBySlug(personaSlug);

  if (!persona) redirect("/");

  // Fetch user's chats with this persona
  const chats = await listOracleChatsByPersona(user.id, persona.id);

  // Fetch messages for current chat if chatId is provided
  let messages: Message[] = [];
  if (chatId) {
    const authorizedChat = await getOracleChatById(chatId);

    if (!authorizedChat || authorizedChat.user_id !== user.id) redirect(`/chat/${personaSlug}`);

    messages = await listOracleMessagesByChat(chatId);
  }

  // Fetch user settings
  const settings = await getOracleUserSettings(user.id);

  return (
    <ChatInterface
      persona={persona}
      chats={chats}
      initialMessages={messages}
      currentChatId={chatId || null}
      settings={settings}
    />
  );
}
