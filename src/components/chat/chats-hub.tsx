"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, MessageSquare, Pencil, Plus, Send, X } from "lucide-react";
import type { Chat, Message, Persona, UserSettings } from "@/types/database";

type ChatTone = "brief" | "teaching" | "in_depth" | "conversational";

interface ChatsHubProps {
  personas: Persona[];
  chats: Chat[];
  initialChatId: string | null;
  initialMessages: Message[];
  settings: UserSettings | null;
}

export function ChatsHub({
  personas,
  chats: initialChats,
  initialChatId,
  initialMessages,
  settings,
}: ChatsHubProps) {
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [chatId, setChatId] = useState<string | null>(initialChatId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [tone, setTone] = useState<ChatTone>("conversational");
  const [isSending, setIsSending] = useState(false);
  const [pendingResponderIds, setPendingResponderIds] = useState<string[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(new Set());
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const hasApiKey = !!settings?.encrypted_api_key;

  const currentChat = useMemo(
    () => chats.find((chat) => chat.id === chatId) || null,
    [chats, chatId]
  );

  function resolveResponseTargets(content: string): string[] {
    const participants = currentChat?.participants || [];
    if (participants.length === 0) return [];
    const mentionMatches = content.match(/@[a-zA-Z0-9_-]+/g) || [];
    if (mentionMatches.length === 0) {
      return participants.map((p) => p.id);
    }
    const mentionTokens = mentionMatches.map((m) => m.slice(1).toLowerCase());
    const targeted = participants.filter((participant) => {
      const slugTokens = participant.slug.toLowerCase().split("-");
      const nameTokens = participant.name.toLowerCase().split(/\s+/);
      const candidates = new Set([participant.slug.toLowerCase(), ...slugTokens, ...nameTokens]);
      return mentionTokens.some((token) => candidates.has(token));
    });
    return (targeted.length > 0 ? targeted : participants).map((p) => p.id);
  }

  async function renameCurrentChat() {
    if (!chatId) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) return;
    const response = await fetch(`/api/chats/${chatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Failed to rename chat");
    setChats((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, title: nextTitle } : chat)));
    setIsEditingTitle(false);
  }

  async function loadChat(nextChatId: string) {
    setChatId(nextChatId);
    const response = await fetch(`/api/chats/${nextChatId}/messages`, { cache: "no-store" });
    const payload = (await response.json()) as { messages?: Message[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Failed to load messages");
    setMessages(payload.messages || []);
    window.history.replaceState(null, "", `/chats?chat=${nextChatId}`);
  }

  async function createChat() {
    const ids = [...selectedPersonaIds];
    if (ids.length === 0) return;
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personaIds: ids,
        title: "New Chat",
      }),
    });
    const payload = (await response.json()) as { chat?: Chat; error?: string };
    if (!response.ok || !payload.chat) throw new Error(payload.error || "Failed to create chat");
    setChats((prev) => [payload.chat as Chat, ...prev]);
    setMessages([]);
    setShowNewChat(false);
    setSelectedPersonaIds(new Set());
    await loadChat(payload.chat.id);
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !chatId || isSending || !hasApiKey) return;
    setIsSending(true);
    setDraft("");
    setPendingResponderIds(resolveResponseTargets(content));

    const userMessage: Message = {
      id: crypto.randomUUID(),
      chat_id: chatId,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    await fetch(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content }),
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          tone,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to chat");
      }

      const payload = (await response.json()) as {
        responses?: Array<{ personaId: string; personaName: string; content: string }>;
      };
      const responses = payload.responses || [];

      if (responses.length === 0) {
        throw new Error("No assistant response received");
      }

      for (const item of responses) {
        const taggedContent = `@${item.personaName}\n${item.content.trim()}`;
        await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "assistant", content: taggedContent }),
        });
      }

      setMessages((prev) => [
        ...prev,
        ...responses.map((item) => ({
          id: crypto.randomUUID(),
          chat_id: chatId,
          role: "assistant" as const,
          content: `@${item.personaName}\n${item.content.trim()}`,
          created_at: new Date().toISOString(),
        })),
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          chat_id: chatId,
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
      setPendingResponderIds([]);
    }
  }

  return (
    <div className="flex h-full">
      <div className="w-72 border-r flex flex-col shrink-0">
        <div className="p-3 border-b">
          <Button className="w-full justify-start gap-2" size="sm" onClick={() => setShowNewChat((v) => !v)}>
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        {showNewChat && (
          <div className="p-3 border-b space-y-2">
            <p className="text-xs text-muted-foreground">Select one or more personas</p>
            <div className="max-h-40 overflow-auto space-y-1">
              {personas.map((persona) => (
                <label key={persona.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedPersonaIds.has(persona.id)}
                    onChange={(e) => {
                      setSelectedPersonaIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(persona.id);
                        else next.delete(persona.id);
                        return next;
                      });
                    }}
                  />
                  {persona.name}
                </label>
              ))}
            </div>
            <Button size="sm" onClick={createChat} disabled={selectedPersonaIds.size === 0}>
              Start Chat
            </Button>
          </div>
        )}

        <ScrollArea className="flex-1 p-2">
          <div className="space-y-1">
            {chats.map((chat) => (
              <button
                key={chat.id}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                  chat.id === chatId ? "bg-accent" : "hover:bg-accent/50"
                }`}
                onClick={() => void loadChat(chat.id)}
              >
                <p className="font-medium truncate">{chat.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {(chat.participants || []).map((p) => p.name).join(", ") || "No participants"}
                </p>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 border-b px-4 flex items-center justify-between">
          <div>
            {isEditingTitle && currentChat ? (
              <div className="flex items-center gap-1">
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void renameCurrentChat();
                    if (e.key === "Escape") setIsEditingTitle(false);
                  }}
                />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void renameCurrentChat()}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setIsEditingTitle(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{currentChat?.title || "Select a chat"}</p>
                {currentChat && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => {
                      setTitleDraft(currentChat.title);
                      setIsEditingTitle(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {(currentChat?.participants || []).map((p) => p.name).join(", ")}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {(["brief", "teaching", "in_depth", "conversational"] as ChatTone[]).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={tone === value ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setTone(value)}
              >
                {value === "in_depth" ? "In-Depth" : value[0].toUpperCase() + value.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-3 max-w-4xl mx-auto">
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Send a message to start the conversation.</p>
                <p className="text-xs mt-1">Use `@persona` to target one persona in group chats.</p>
              </div>
            )}
            {messages.map((message) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap bg-primary text-primary-foreground">
                      {message.content}
                    </div>
                  </div>
                );
              }

              const assistantPrefix = message.content.match(/^@([^\n]+)\n([\s\S]*)$/);
              const assistantName = assistantPrefix?.[1]?.trim() || "Assistant";
              const assistantBody = assistantPrefix?.[2]?.trim() || message.content;
              const participant = (currentChat?.participants || []).find(
                (p) => p.name.toLowerCase() === assistantName.toLowerCase()
              );
              const initials = assistantName
                .split(" ")
                .map((s) => s[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

              return (
                <div key={message.id} className="flex justify-start gap-2">
                  <Avatar className="h-7 w-7 mt-0.5">
                    {participant?.image_url && <AvatarImage src={participant.image_url} />}
                    <AvatarFallback className="text-[10px]">{initials || "AI"}</AvatarFallback>
                  </Avatar>
                  <div className="max-w-[85%]">
                    <p className="text-xs text-muted-foreground mb-1">{assistantName}</p>
                    <div className="rounded-xl px-3 py-2 text-sm whitespace-pre-wrap bg-muted">{assistantBody}</div>
                  </div>
                </div>
              );
            })}

            {isSending && pendingResponderIds.length > 0 && (
              <div className="space-y-2">
                {pendingResponderIds.map((personaId) => {
                  const participant = (currentChat?.participants || []).find((p) => p.id === personaId);
                  if (!participant) return null;
                  const initials = participant.name
                    .split(" ")
                    .map((s) => s[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                    <div key={`pending-${personaId}`} className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        {participant.image_url && <AvatarImage src={participant.image_url} />}
                        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                      </Avatar>
                      <p className="text-xs text-muted-foreground">
                        {participant.name} <span className="animate-pulse">(responding)</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t">
          <div className="px-4 py-2 bg-amber-500/5 border-b">
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              AI Simulation Only: Personas are fictional AI constructs based on public data, not
              real people. Content may be inaccurate and is for entertainment/educational use only.
            </p>
          </div>
          <div className="p-3">
            {!hasApiKey && <p className="text-xs text-destructive mb-2">Add API key in Settings to chat.</p>}
            <div className="flex items-end gap-2 max-w-4xl mx-auto">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message..."
                disabled={!chatId || !hasApiKey || isSending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <Button onClick={() => void sendMessage()} disabled={!chatId || !draft.trim() || isSending || !hasApiKey}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
