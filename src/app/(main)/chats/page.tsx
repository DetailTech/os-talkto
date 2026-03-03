import { ChatsHub } from "@/components/chat/chats-hub";
import type { Message } from "@/types/database";
import { requireUser } from "@/lib/auth/server";
import {
  getOracleUserSettings,
  listOracleChatParticipants,
  listOracleChatsByUser,
  listOracleMessagesByChat,
  listOraclePersonas,
} from "@/lib/db/oracle";

export const dynamic = "force-dynamic";

interface ChatsPageProps {
  searchParams: Promise<{ chat?: string }>;
}

export default async function ChatsPage({ searchParams }: ChatsPageProps) {
  const { chat: chatId } = await searchParams;
  const user = await requireUser();
  const personas = await listOraclePersonas();
  const settings = await getOracleUserSettings(user.id);
  const chats = await listOracleChatsByUser(user.id);
  const enrichedChats = await Promise.all(
    chats.map(async (chat) => ({
      ...chat,
      participants: await listOracleChatParticipants(chat.id),
    }))
  );

  const selectedChatId =
    chatId && enrichedChats.some((chat) => chat.id === chatId)
      ? chatId
      : (enrichedChats[0]?.id ?? null);

  let messages: Message[] = [];
  if (selectedChatId) {
    messages = await listOracleMessagesByChat(selectedChatId);
  }

  return (
    <div className="h-full overflow-hidden">
      <ChatsHub
        personas={personas}
        chats={enrichedChats}
        initialChatId={selectedChatId}
        initialMessages={messages}
        settings={settings}
      />
    </div>
  );
}
