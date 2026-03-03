"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatSidebar } from "./chat-sidebar";
import { ChatMessages } from "./chat-messages";
import { ChatInput } from "./chat-input";
import { PersonaPanel } from "./persona-panel";
import { Button } from "@/components/ui/button";
import { PanelRight, PanelRightClose } from "lucide-react";
import type { Persona, Chat, Message, UserSettings } from "@/types/database";

type ChatTone = "brief" | "teaching" | "in_depth" | "conversational";

interface ChatInterfaceProps {
  persona: Persona;
  chats: Chat[];
  initialMessages: Message[];
  currentChatId: string | null;
  settings: UserSettings | null;
}

export function ChatInterface({
  persona,
  chats: initialChats,
  initialMessages,
  currentChatId,
  settings,
}: ChatInterfaceProps) {
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [chatId, setChatId] = useState<string | null>(currentChatId);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [showPersonaPanel, setShowPersonaPanel] = useState(true);
  const [tone, setTone] = useState<ChatTone>("conversational");
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  async function createNewChat(): Promise<string> {
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personaId: persona.id,
        title: "New Chat",
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.chat) throw new Error(payload.error || "Failed to create chat");
    const data = payload.chat as Chat;

    setChats((prev) => [data as Chat, ...prev]);
    setChatId(data.id);
    setMessages([]);
    window.history.replaceState(null, "", `/chat/${persona.slug}?chat=${data.id}`);
    return data.id;
  }

  async function handleNewChat() {
    const newChatId = await createNewChat();
    setChatId(newChatId);
    setMessages([]);
  }

  async function handleSelectChat(selectedChatId: string) {
    setChatId(selectedChatId);
    window.history.replaceState(null, "", `/chat/${persona.slug}?chat=${selectedChatId}`);

    const response = await fetch(`/api/chats/${selectedChatId}/messages`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Failed to load messages");
    setMessages((payload.messages as Message[]) || []);
  }

  async function handleDeleteChat(deleteChatId: string) {
    await fetch(`/api/chats/${deleteChatId}`, { method: "DELETE" });
    setChats((prev) => prev.filter((c) => c.id !== deleteChatId));
    if (chatId === deleteChatId) {
      setChatId(null);
      setMessages([]);
      window.history.replaceState(null, "", `/chat/${persona.slug}`);
    }
  }

  async function sendMessage(content: string) {
    if (!content.trim() || isStreaming) return;

    let activeChatId = chatId;
    if (!activeChatId) {
      activeChatId = await createNewChat();
    }

    // Add user message to UI immediately
    const userMessage: Message = {
      id: crypto.randomUUID(),
      chat_id: activeChatId,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Save user message to DB
    await fetch(`/api/chats/${activeChatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "user",
        content,
      }),
    });

    // Update chat title if first message
    if (messages.length === 0) {
      const title = content.slice(0, 80) + (content.length > 80 ? "..." : "");
      await fetch(`/api/chats/${activeChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setChats((prev) =>
        prev.map((c) => (c.id === activeChatId ? { ...c, title } : c))
      );
    }

    // Stream AI response
    setIsStreaming(true);
    setStreamingContent("");

    try {
      const readResponseText = async (response: Response, existingPrefix: string = ""): Promise<string> => {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const contentType = response.headers.get("content-type") || "";
        const isEventStream = contentType.includes("text/event-stream");
        const decoder = new TextDecoder();
        let fullContent = existingPrefix;
        let buffer = "";

        const pushToken = (token: string) => {
          if (!token) return;
          fullContent += token;
          setStreamingContent(fullContent);
        };

        const processProtocolPayload = (payload: string) => {
          if (!payload || payload === "[DONE]") return;

          if (payload.startsWith("0:")) {
            const raw = payload.slice(2);
            try {
              const parsed = JSON.parse(raw) as unknown;
              if (typeof parsed === "string") {
                pushToken(parsed);
                return;
              }
              if (parsed && typeof parsed === "object") {
                const maybe = parsed as { text?: unknown; delta?: unknown };
                if (typeof maybe.text === "string") {
                  pushToken(maybe.text);
                  return;
                }
                if (typeof maybe.delta === "string") {
                  pushToken(maybe.delta);
                  return;
                }
              }
            } catch {
              // Fall through to plain text handling
            }
            pushToken(raw);
            return;
          }

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              pushToken(token);
              return;
            }
          } catch {
            // Not JSON payload, treat as plain text
          }

          pushToken(payload);
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          if (!isEventStream) {
            pushToken(text);
            continue;
          }

          buffer += text;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;
            processProtocolPayload(trimmed.slice(5).trim());
          }
        }

        if (isEventStream && buffer.trim().startsWith("data:")) {
          processProtocolPayload(buffer.trim().slice(5).trim());
        }

        return fullContent;
      };

      const baseMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: baseMessages,
          personaId: persona.id,
          tone,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to get response");
      }

      let fullContent = await readResponseText(response);
      const serverTruncated = response.headers.get("x-ai-truncated") === "1";
      const likelyTruncated =
        fullContent.trim().length > 240 &&
        !/[.!?]"?$/.test(fullContent.trim());

      // Retry-continue once if completion looks cut off.
      if (serverTruncated || likelyTruncated) {
        const continueResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              ...baseMessages,
              { role: "assistant", content: fullContent },
              {
                role: "user",
                content:
                  "Continue exactly from where you stopped. Do not repeat prior text. Finish cleanly.",
              },
            ],
            personaId: persona.id,
            tone,
          }),
        });
        if (continueResponse.ok) {
          const continuation = await readResponseText(continueResponse, fullContent);
          if (continuation.trim().length > fullContent.trim().length) {
            fullContent = continuation;
          }
        }
      }

      if (fullContent.trim()) {
        // Save assistant message
        const saveResponse = await fetch(`/api/chats/${activeChatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "assistant",
            content: fullContent,
          }),
        });
        const savePayload = await saveResponse.json().catch(() => ({}));
        const savedMsg = savePayload.message as Message | undefined;

        setMessages((prev) => [
          ...prev,
          {
            id: savedMsg?.id || crypto.randomUUID(),
            chat_id: activeChatId!,
            role: "assistant",
            content: fullContent,
            created_at: new Date().toISOString(),
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            chat_id: activeChatId!,
            role: "assistant",
            content:
              "I didn't receive a response from the selected model. Verify provider, model, and API key in Settings, then try again.",
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "An error occurred";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          chat_id: activeChatId!,
          role: "assistant",
          content: `Sorry, I encountered an error: ${errorMessage}. Please check your API key in Settings.`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  }

  async function handleRegenerate() {
    if (messages.length < 2 || isStreaming) return;

    // Get the last user message
    const lastUserMsgIndex = [...messages]
      .reverse()
      .findIndex((m) => m.role === "user");
    if (lastUserMsgIndex === -1) return;

    const actualIndex = messages.length - 1 - lastUserMsgIndex;
    const lastUserMessage = messages[actualIndex];

    // Remove last assistant message from UI
    setMessages((prev) => prev.slice(0, -1));

    // Delete last assistant message from DB
    const lastAssistantMsg = messages[messages.length - 1];
    if (lastAssistantMsg.role === "assistant") {
      await fetch(`/api/messages/${lastAssistantMsg.id}`, { method: "DELETE" });
    }

    // Re-send
    const updatedMessages = messages.slice(0, -1);
    setMessages(updatedMessages);

    // Trigger send with the last user content
    await sendMessage(lastUserMessage.content);
  }

  const hasApiKey = !!settings?.encrypted_api_key;

  return (
    <div className="flex h-full">
      {/* Chat list sidebar */}
      <ChatSidebar
        chats={chats}
        currentChatId={chatId}
        personaName={persona.name}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-4 border-b shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="font-semibold text-sm truncate">
              Chat with {persona.name}
            </h2>
            <div className="hidden md:flex items-center gap-1">
              <Button
                type="button"
                variant={tone === "brief" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setTone("brief")}
              >
                Brief
              </Button>
              <Button
                type="button"
                variant={tone === "teaching" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setTone("teaching")}
              >
                Teaching
              </Button>
              <Button
                type="button"
                variant={tone === "in_depth" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setTone("in_depth")}
              >
                In-Depth
              </Button>
              <Button
                type="button"
                variant={tone === "conversational" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setTone("conversational")}
              >
                Conversational
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hidden lg:flex"
            onClick={() => setShowPersonaPanel(!showPersonaPanel)}
          >
            {showPersonaPanel ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRight className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="md:hidden px-4 py-2 border-b">
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant={tone === "brief" ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setTone("brief")}
            >
              Brief
            </Button>
            <Button
              type="button"
              variant={tone === "teaching" ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setTone("teaching")}
            >
              Teaching
            </Button>
            <Button
              type="button"
              variant={tone === "in_depth" ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setTone("in_depth")}
            >
              In-Depth
            </Button>
            <Button
              type="button"
              variant={tone === "conversational" ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setTone("conversational")}
            >
              Conversational
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <ChatMessages
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            persona={persona}
            onStarterClick={sendMessage}
            hasApiKey={hasApiKey}
            onRegenerate={handleRegenerate}
          />
        </div>

        <div className="border-t">
          <div className="px-4 py-2 bg-amber-500/5 border-b">
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              AI Simulation Only: This is a fictional chatbot based on public data. It is not the
              real person and is not affiliated with or endorsed by them. Responses are for
              entertainment/educational use only and may be inaccurate.
            </p>
          </div>
          {/* Input */}
          <ChatInput
            onSend={sendMessage}
            isStreaming={isStreaming}
            disabled={!hasApiKey}
            placeholder={
              hasApiKey
                ? `Ask ${persona.name} anything...`
                : "Set your API key in Settings first"
            }
          />
        </div>
      </div>

      {/* Persona panel */}
      {showPersonaPanel && (
        <div className="hidden lg:block w-72 xl:w-80 border-l overflow-y-auto shrink-0">
          <PersonaPanel persona={persona} />
        </div>
      )}
    </div>
  );
}
