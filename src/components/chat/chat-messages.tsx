"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Copy, Check, RotateCcw, User, Settings, Sparkles } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { Persona, Message } from "@/types/database";
import Link from "next/link";

interface ChatMessagesProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  persona: Persona;
  onStarterClick: (content: string) => void;
  hasApiKey: boolean;
  onRegenerate: () => void;
}

export function ChatMessages({
  messages,
  streamingContent,
  isStreaming,
  persona,
  onStarterClick,
  hasApiKey,
  onRegenerate,
}: ChatMessagesProps) {
  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 py-12">
        <Avatar className="h-20 w-20 mb-4">
          {persona.image_url && <AvatarImage src={persona.image_url} />}
          <AvatarFallback className="text-2xl font-semibold bg-primary/10 text-primary">
            {persona.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </AvatarFallback>
        </Avatar>
        <h2 className="text-xl font-semibold mb-1">Chat with {persona.name}</h2>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-8">
          Ask anything about {persona.expertise.slice(0, 3).join(", ")}, and more.
          {persona.name} will answer based on their books and podcasts.
        </p>

        {!hasApiKey && (
          <div className="mb-6 p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 max-w-md text-center">
            <Settings className="h-5 w-5 text-amber-600 dark:text-amber-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">API Key Required</p>
            <p className="text-xs text-muted-foreground mt-1">
              Go to{" "}
              <Link href="/settings" className="text-primary underline">
                Settings
              </Link>{" "}
              to configure your AI provider and API key.
            </p>
          </div>
        )}

        {/* Conversation starters */}
        {hasApiKey && persona.conversation_starters?.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
            {persona.conversation_starters.map((starter, i) => (
              <button
                key={i}
                onClick={() => onStarterClick(starter)}
                className="group text-left p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                    {starter}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          persona={persona}
          isLast={message === messages[messages.length - 1]}
          onRegenerate={onRegenerate}
          isStreaming={isStreaming}
        />
      ))}

      {isStreaming && streamingContent && (
        <div className="flex gap-3">
          <Avatar className="h-8 w-8 shrink-0 mt-0.5">
            {persona.image_url && <AvatarImage src={persona.image_url} />}
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              {persona.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="prose-chat text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {streamingContent}
              </ReactMarkdown>
              <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5" />
            </div>
          </div>
        </div>
      )}

      {isStreaming && !streamingContent && (
        <div className="flex gap-3">
          <Avatar className="h-8 w-8 shrink-0 mt-0.5">
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              {persona.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center gap-1 py-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  persona,
  isLast,
  onRegenerate,
  isStreaming,
}: {
  message: Message;
  persona: Persona;
  isLast: boolean;
  onRegenerate: () => void;
  isStreaming: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copyContent() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (message.role === "user") {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[85%]">
          <div className="rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5">
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
        <Avatar className="h-8 w-8 shrink-0 mt-0.5">
          <AvatarFallback className="text-xs bg-muted">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Avatar className="h-8 w-8 shrink-0 mt-0.5">
        {persona.image_url && <AvatarImage src={persona.image_url} />}
        <AvatarFallback className="text-xs bg-primary/10 text-primary">
          {persona.name
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="prose-chat text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Actions */}
        <div className={cn(
          "flex items-center gap-1 mt-2 transition-opacity",
          isLast ? "opacity-100" : "opacity-0 hover:opacity-100"
        )}>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyContent}>
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
          {isLast && !isStreaming && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRegenerate}>
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
