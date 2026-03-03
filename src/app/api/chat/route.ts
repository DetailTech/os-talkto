import { generateText } from "ai";
import { getLanguageModel } from "@/lib/ai-providers";
import { getRelevantChunks, buildSystemPrompt } from "@/lib/rag";
import { decrypt } from "@/lib/encryption";
import type { Persona, UserSettings } from "@/types/database";
import { getCurrentUser } from "@/lib/auth/server";
import {
  getOracleChatById,
  getOraclePersonaById,
  getOracleUserSettings,
  listOracleChatParticipants,
  listOraclePersonasByIds,
} from "@/lib/db/oracle";

type ChatTone = "brief" | "teaching" | "in_depth" | "conversational";

type ChatMessage = { role: "user" | "assistant"; content: string };

async function generateWithContinuation(input: {
  model: ReturnType<typeof getLanguageModel>;
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  maxContinuations?: number;
}): Promise<{ text: string; truncated: boolean }> {
  const maxContinuations = input.maxContinuations ?? 2;
  const workingMessages: ChatMessage[] = [...input.messages];
  let fullText = "";
  let truncated = false;

  for (let i = 0; i <= maxContinuations; i++) {
    const response = await generateText({
      model: input.model,
      system: input.system,
      messages: workingMessages,
      maxOutputTokens: input.maxOutputTokens,
    });

    const chunk = response.text.trim();
    if (chunk) {
      fullText += chunk;
    }

    const finishReason = String((response as unknown as { finishReason?: unknown }).finishReason || "");
    const hitLength = finishReason.toLowerCase() === "length";
    if (!hitLength) {
      truncated = false;
      break;
    }

    truncated = true;
    if (i >= maxContinuations) break;

    // Continue from partial output without repeating.
    workingMessages.push(
      {
        role: "assistant",
        content: chunk,
      },
      {
        role: "user",
        content:
          "Continue exactly from where you stopped. Do not repeat prior text. Keep the same tone and structure.",
      }
    );
  }

  return { text: fullText, truncated };
}

function getToneInstruction(tone: ChatTone): string {
  switch (tone) {
    case "brief":
      return `Tone mode: Brief.
- Keep responses short and quickly scannable.
- Prefer concise bullet points and short sections.
- Include only high-value details unless user asks for depth.`;
    case "teaching":
      return `Tone mode: Teaching.
- Explain concepts clearly and step-by-step.
- Use concrete examples where useful.
- Define important terms and assumptions.`;
    case "in_depth":
      return `Tone mode: In-Depth.
- Provide comprehensive, exhaustive coverage.
- Include nuanced tradeoffs, edge cases, and practical implications.
- Structure with clear sections for readability.`;
    case "conversational":
    default:
      return `Tone mode: Conversational.
- Keep responses moderately short and collaborative.
- Ask brief clarifying questions when needed to improve accuracy.
- Prefer iterative back-and-forth over long monologues.`;
  }
}

export async function POST(request: Request) {
  try {
    const { messages, personaId, chatId, tone } = (await request.json()) as {
      messages?: Array<{ role: string; content: string }>;
      personaId?: string;
      chatId?: string;
      tone?: ChatTone;
    };

    if (!messages || (!personaId && !chatId)) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const user = await getCurrentUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings: UserSettings | null = await getOracleUserSettings(user.id);

    if (!settings?.encrypted_api_key) {
      return Response.json(
        { error: "No API key configured. Go to Settings to add one." },
        { status: 400 }
      );
    }

    const apiKey = decrypt(settings.encrypted_api_key);
    const model = getLanguageModel(
      settings.ai_provider,
      settings.ai_model,
      apiKey
    );

    const selectedTone: ChatTone = tone || "conversational";
    const lastUserMessage = messages.filter((m: { role: string }) => m.role === "user").pop();

    if (!chatId) {
      const typedPersona: Persona | null = await getOraclePersonaById(personaId as string);
      if (!typedPersona) {
        return Response.json({ error: "Persona not found" }, { status: 404 });
      }

      let contextChunks: { content: string }[] = [];
      if (lastUserMessage) {
        try {
          contextChunks = await getRelevantChunks(
            lastUserMessage.content,
            typedPersona.id,
            settings.ai_provider,
            apiKey
          );
        } catch (embeddingError) {
          console.error("Embedding/RAG error (continuing without context):", embeddingError);
        }
      }

      const systemPrompt = `${buildSystemPrompt(typedPersona, contextChunks)}

${getToneInstruction(selectedTone)}`;

      const result = await generateWithContinuation({
        model,
        system: systemPrompt,
        messages: messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        maxOutputTokens: 4096,
        maxContinuations: 2,
      });
      return new Response(result.text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-AI-Truncated": result.truncated ? "1" : "0",
        },
      });
    }

    const chat = await getOracleChatById(chatId);
    if (!chat || chat.user_id !== user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const participantRefs = await listOracleChatParticipants(chatId);
    const participants = await listOraclePersonasByIds(participantRefs.map((p) => p.id));
    if (participants.length === 0) {
      return Response.json({ error: "No chat participants found" }, { status: 400 });
    }

    const mentionMatches = (lastUserMessage?.content || "")
      .match(/@[a-zA-Z0-9_-]+/g) || [];
    const mentionTokens = mentionMatches.map((m) => m.slice(1).toLowerCase());
    const targetParticipants =
      mentionTokens.length === 0
        ? participants
        : participants.filter((p) => {
            const slugTokens = p.slug.toLowerCase().split("-");
            const nameTokens = p.name.toLowerCase().split(/\s+/);
            const candidates = new Set([p.slug.toLowerCase(), ...slugTokens, ...nameTokens]);
            return mentionTokens.some((token) => candidates.has(token));
          });
    const respondingParticipants = targetParticipants.length > 0 ? targetParticipants : participants;

    const priorAssistantContent = messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n\n");
    const groupResponses: Array<{ personaId: string; personaName: string; content: string }> = [];

    for (let i = 0; i < respondingParticipants.length; i++) {
      const persona = respondingParticipants[i];
      let contextChunks: { content: string }[] = [];
      if (lastUserMessage) {
        try {
          contextChunks = await getRelevantChunks(
            lastUserMessage.content,
            persona.id,
            settings.ai_provider,
            apiKey
          );
        } catch (embeddingError) {
          console.error("Embedding/RAG error (continuing without context):", embeddingError);
        }
      }

      const groupInstruction = `Group chat rules:
- Keep this response more concise than a 1:1 chat.
- Avoid repeating points already covered by other personas.
- Only add incremental perspective that is distinct and useful.
- Do not start side-conversations with other personas unless absolutely essential.
- Never produce AI-to-AI loops.`;

      const priorInThisTurn = groupResponses
        .map((entry) => `@${entry.personaName}\n${entry.content}`)
        .join("\n\n");
      const systemPrompt = `${buildSystemPrompt(persona, contextChunks)}
${getToneInstruction(selectedTone)}
${groupInstruction}`;

      const response = await generateWithContinuation({
        model,
        system: systemPrompt,
        messages: [
          ...messages.map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          {
            role: "user",
            content:
              `Previous assistant context:\n${priorAssistantContent || "(none)"}\n\n` +
              `Responses from other personas in this same turn:\n${priorInThisTurn || "(none)"}\n\n` +
              `Now answer as ${persona.name}.`,
          },
        ],
        maxOutputTokens: 2400,
        maxContinuations: 2,
      });

      groupResponses.push({
        personaId: persona.id,
        personaName: persona.name,
        content: response.text.trim(),
      });
    }

    return Response.json({ responses: groupResponses });
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
