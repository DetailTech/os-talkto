import { randomUUID } from "node:crypto";
import oracledb from "oracledb";
import { AI_PROVIDERS } from "@/types/database";
import type {
  AIProvider,
  Chat,
  Message,
  Persona,
  PersonaIngestJob,
  UserSettings,
} from "@/types/database";

let poolPromise: Promise<oracledb.Pool> | null = null;
oracledb.fetchAsString = [oracledb.CLOB];
let chatParticipantsSchemaReady = false;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function getOraclePool(): Promise<oracledb.Pool> {
  if (!poolPromise) {
    poolPromise = oracledb.createPool({
      user: requireEnv("ORACLE_USER"),
      password: requireEnv("ORACLE_PASSWORD"),
      connectString: requireEnv("ORACLE_CONNECT_STRING"),
      poolMin: 1,
      poolMax: 10,
      poolIncrement: 1,
      stmtCacheSize: 30,
    });
  }

  return poolPromise;
}

async function run<T = Record<string, unknown>>(
  sql: string,
  binds: oracledb.BindParameters = {}
): Promise<T[]> {
  const pool = await getOraclePool();
  const connection = await pool.getConnection();

  try {
    const result = await connection.execute<T>(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
    });

    return (result.rows as T[]) || [];
  } finally {
    await connection.close();
  }
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asJsonArray<T = Record<string, unknown>>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function mapPersona(row: Record<string, unknown>): Persona {
  return {
    id: asText(row.ID ?? row.id),
    slug: asText(row.SLUG ?? row.slug),
    name: asText(row.NAME ?? row.name),
    bio: asText(row.BIO ?? row.bio),
    expertise: asStringArray(row.EXPERTISE_JSON ?? row.expertise_json),
    books_json: asJsonArray(row.BOOKS_JSON ?? row.books_json),
    podcasts_json: asJsonArray(row.PODCASTS_JSON ?? row.podcasts_json),
    image_url: (row.IMAGE_URL ?? row.image_url) as string | null,
    conversation_starters: asStringArray(
      row.CONVERSATION_STARTERS_JSON ?? row.conversation_starters_json
    ),
    created_at: asText(row.CREATED_AT ?? row.created_at),
  };
}

function mapUserSettings(row: Record<string, unknown>): UserSettings {
  const providerText = asText(row.AI_PROVIDER ?? row.ai_provider);
  const allowedProviders = new Set<AIProvider>(AI_PROVIDERS.map((p) => p.id));
  const aiProvider: AIProvider = allowedProviders.has(providerText as AIProvider)
    ? (providerText as AIProvider)
    : "openai";

  return {
    id: asText(row.ID ?? row.id),
    user_id: asText(row.USER_ID ?? row.user_id),
    ai_provider: aiProvider,
    ai_model: asText(row.AI_MODEL ?? row.ai_model),
    encrypted_api_key: (row.ENCRYPTED_API_KEY ?? row.encrypted_api_key) as string | null,
    favorite_personas: asStringArray(row.FAVORITE_PERSONAS_JSON ?? row.favorite_personas_json),
    created_at: asText(row.CREATED_AT ?? row.created_at),
    updated_at: asText(row.UPDATED_AT ?? row.updated_at),
  };
}

function mapChat(row: Record<string, unknown>): Chat {
  return {
    id: asText(row.ID ?? row.id),
    user_id: asText(row.USER_ID ?? row.user_id),
    persona_id: asText(row.PERSONA_ID ?? row.persona_id),
    title: asText(row.TITLE ?? row.title),
    created_at: asText(row.CREATED_AT ?? row.created_at),
  };
}

function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: asText(row.ID ?? row.id),
    chat_id: asText(row.CHAT_ID ?? row.chat_id),
    role: asText(row.ROLE ?? row.role) as Message["role"],
    content: asText(row.CONTENT ?? row.content),
    created_at: asText(row.CREATED_AT ?? row.created_at),
  };
}

function mapPersonaIngestJob(row: Record<string, unknown>): PersonaIngestJob {
  const sources = parseJsonObject(row.SOURCES_JSON ?? row.sources_json);
  return {
    id: asText(row.ID ?? row.id),
    user_id: asText(row.USER_ID ?? row.user_id),
    persona_id: asText(row.PERSONA_ID ?? row.persona_id),
    query: asText(row.QUERY ?? row.query),
    sources: {
      books: sources.books !== false,
      podcasts: sources.podcasts !== false,
      youtube: sources.youtube !== false,
      blogs: sources.blogs !== false,
      interviews: sources.interviews !== false,
      social: sources.social !== false,
    },
    status: asText(row.STATUS ?? row.status) as PersonaIngestJob["status"],
    step: asText(row.STEP ?? row.step) || null,
    progress_percent: Number(row.PROGRESS_PERCENT ?? row.progress_percent ?? 0),
    stats: parseJsonObject(row.STATS_JSON ?? row.stats_json),
    error_message: asText(row.ERROR_MESSAGE ?? row.error_message) || null,
    created_at: asText(row.CREATED_AT ?? row.created_at),
    updated_at: asText(row.UPDATED_AT ?? row.updated_at),
    started_at: asText(row.STARTED_AT ?? row.started_at) || null,
    completed_at: asText(row.COMPLETED_AT ?? row.completed_at) || null,
    persona_name: asText(row.PERSONA_NAME ?? row.persona_name) || undefined,
    persona_slug: asText(row.PERSONA_SLUG ?? row.persona_slug) || undefined,
  };
}

let personaIngestSchemaReady = false;
async function ensurePersonaIngestSchema(): Promise<void> {
  if (personaIngestSchemaReady) return;
  const pool = await getOraclePool();
  const connection = await pool.getConnection();
  try {
    try {
      await connection.execute(`
        CREATE TABLE persona_ingest_jobs (
          id VARCHAR2(36) PRIMARY KEY,
          user_id VARCHAR2(36) NOT NULL,
          persona_id VARCHAR2(36) NOT NULL,
          query VARCHAR2(300) NOT NULL,
          sources_json CLOB CHECK (sources_json IS JSON),
          status VARCHAR2(20) NOT NULL,
          step VARCHAR2(200),
          progress_percent NUMBER(5,2) DEFAULT 0 NOT NULL,
          stats_json CLOB CHECK (stats_json IS JSON),
          error_message CLOB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
          started_at TIMESTAMP WITH TIME ZONE,
          completed_at TIMESTAMP WITH TIME ZONE,
          CONSTRAINT fk_ingest_jobs_persona FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
          CONSTRAINT chk_ingest_jobs_status CHECK (status IN ('queued', 'running', 'completed', 'failed'))
        )
      `);
    } catch (error) {
      if (!(error && typeof error === "object" && "errorNum" in error && error.errorNum === 955)) {
        throw error;
      }
    }

    try {
      await connection.execute(
        "CREATE INDEX idx_ingest_jobs_user_created ON persona_ingest_jobs(user_id, created_at DESC)"
      );
    } catch (error) {
      if (!(error && typeof error === "object" && "errorNum" in error && error.errorNum === 955)) {
        throw error;
      }
    }

    try {
      await connection.execute(
        "CREATE INDEX idx_ingest_jobs_status ON persona_ingest_jobs(status, updated_at DESC)"
      );
    } catch (error) {
      if (!(error && typeof error === "object" && "errorNum" in error && error.errorNum === 955)) {
        throw error;
      }
    }

    personaIngestSchemaReady = true;
  } finally {
    await connection.close();
  }
}

async function ensureChatParticipantsSchema(): Promise<void> {
  if (chatParticipantsSchemaReady) return;
  const pool = await getOraclePool();
  const connection = await pool.getConnection();
  try {
    try {
      await connection.execute(`
        CREATE TABLE chat_participants (
          chat_id VARCHAR2(36) NOT NULL,
          persona_id VARCHAR2(36) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
          CONSTRAINT pk_chat_participants PRIMARY KEY (chat_id, persona_id),
          CONSTRAINT fk_chat_participants_chat FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
          CONSTRAINT fk_chat_participants_persona FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
        )
      `);
    } catch (error) {
      if (!(error && typeof error === "object" && "errorNum" in error && error.errorNum === 955)) {
        throw error;
      }
    }

    try {
      await connection.execute(
        "CREATE INDEX idx_chat_participants_persona ON chat_participants(persona_id)"
      );
    } catch (error) {
      if (!(error && typeof error === "object" && "errorNum" in error && error.errorNum === 955)) {
        throw error;
      }
    }

    await connection.execute(`
      MERGE INTO chat_participants cp
      USING chats c
      ON (cp.chat_id = c.id AND cp.persona_id = c.persona_id)
      WHEN NOT MATCHED THEN
        INSERT (chat_id, persona_id, created_at)
        VALUES (c.id, c.persona_id, SYSTIMESTAMP)
    `);

    chatParticipantsSchemaReady = true;
  } finally {
    await connection.close();
  }
}

export async function listOraclePersonas(): Promise<Persona[]> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT
        id,
        slug,
        name,
        bio,
        expertise_json,
        books_json,
        podcasts_json,
        image_url,
        conversation_starters_json,
        created_at
      FROM personas
      ORDER BY name
    `
  );

  return rows.map(mapPersona);
}

export async function listOraclePersonasBasic(): Promise<Pick<Persona, "id" | "slug" | "name">[]> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT id, slug, name
      FROM personas
      ORDER BY name
    `
  );

  return rows.map((row) => ({
    id: asText(row.ID ?? row.id),
    slug: asText(row.SLUG ?? row.slug),
    name: asText(row.NAME ?? row.name),
  }));
}

export async function listOraclePersonasMissingImage(): Promise<Pick<Persona, "id" | "name" | "slug">[]> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT id, slug, name
      FROM personas
      WHERE image_url IS NULL OR TRIM(image_url) = ''
      ORDER BY name
    `
  );

  return rows.map((row) => ({
    id: asText(row.ID ?? row.id),
    slug: asText(row.SLUG ?? row.slug),
    name: asText(row.NAME ?? row.name),
  }));
}

export async function listOraclePersonasByIds(personaIds: string[]): Promise<Persona[]> {
  if (personaIds.length === 0) return [];
  const binds: oracledb.BindParameters = {};
  const placeholders: string[] = [];
  for (let i = 0; i < personaIds.length; i++) {
    const key = `persona_id_${i}`;
    binds[key] = personaIds[i];
    placeholders.push(`:${key}`);
  }

  const rows = await run<Record<string, unknown>>(
    `
      SELECT
        id,
        slug,
        name,
        bio,
        expertise_json,
        books_json,
        podcasts_json,
        image_url,
        conversation_starters_json,
        created_at
      FROM personas
      WHERE id IN (${placeholders.join(", ")})
    `,
    binds
  );

  const byId = new Map(rows.map((row) => {
    const persona = mapPersona(row);
    return [persona.id, persona] as const;
  }));
  return personaIds.map((id) => byId.get(id)).filter((p): p is Persona => !!p);
}

export async function getOraclePersonaById(personaId: string): Promise<Persona | null> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT
        id,
        slug,
        name,
        bio,
        expertise_json,
        books_json,
        podcasts_json,
        image_url,
        conversation_starters_json,
        created_at
      FROM personas
      WHERE id = :id
      FETCH FIRST 1 ROWS ONLY
    `,
    { id: personaId }
  );

  const row = rows[0];
  return row ? mapPersona(row) : null;
}

export async function getOraclePersonaBySlug(slug: string): Promise<Persona | null> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT
        id,
        slug,
        name,
        bio,
        expertise_json,
        books_json,
        podcasts_json,
        image_url,
        conversation_starters_json,
        created_at
      FROM personas
      WHERE slug = :slug
      FETCH FIRST 1 ROWS ONLY
    `,
    { slug }
  );

  const row = rows[0];
  return row ? mapPersona(row) : null;
}

export async function getOracleUserSettings(userId: string): Promise<UserSettings | null> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT
        id,
        user_id,
        ai_provider,
        ai_model,
        encrypted_api_key,
        favorite_personas_json,
        created_at,
        updated_at
      FROM user_settings
      WHERE user_id = :user_id
      FETCH FIRST 1 ROWS ONLY
    `,
    { user_id: userId }
  );

  const row = rows[0];
  return row ? mapUserSettings(row) : null;
}

export async function upsertOracleUserSettings(userId: string): Promise<void> {
  await run(
    `
      MERGE INTO user_settings tgt
      USING (SELECT :user_id AS user_id FROM dual) src
      ON (tgt.user_id = src.user_id)
      WHEN MATCHED THEN
        UPDATE SET updated_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (
          id,
          user_id,
          ai_provider,
          ai_model,
          favorite_personas_json,
          created_at,
          updated_at
        )
        VALUES (
          :id,
          :user_id,
          'openai',
          'gpt-4o',
          '[]',
          SYSTIMESTAMP,
          SYSTIMESTAMP
        )
    `,
    {
      id: userId,
      user_id: userId,
    }
  );
}

export async function saveOracleUserSettings(input: {
  userId: string;
  provider: string;
  model: string;
  encryptedApiKey?: string;
}): Promise<void> {
  const existing = await run<Record<string, unknown>>(
    `
      SELECT id
      FROM user_settings
      WHERE user_id = :user_id
      FETCH FIRST 1 ROWS ONLY
    `,
    { user_id: input.userId }
  );

  if (existing.length > 0) {
    if (input.encryptedApiKey !== undefined) {
      await run(
        `
          UPDATE user_settings
          SET
            ai_provider = :ai_provider,
            ai_model = :ai_model,
            encrypted_api_key = :encrypted_api_key,
            updated_at = SYSTIMESTAMP
          WHERE user_id = :user_id
        `,
        {
          user_id: input.userId,
          ai_provider: input.provider,
          ai_model: input.model,
          encrypted_api_key: input.encryptedApiKey,
        }
      );
    } else {
      await run(
        `
          UPDATE user_settings
          SET
            ai_provider = :ai_provider,
            ai_model = :ai_model,
            updated_at = SYSTIMESTAMP
          WHERE user_id = :user_id
        `,
        {
          user_id: input.userId,
          ai_provider: input.provider,
          ai_model: input.model,
        }
      );
    }
    return;
  }

  await run(
    `
      INSERT INTO user_settings (
        id,
        user_id,
        ai_provider,
        ai_model,
        encrypted_api_key,
        favorite_personas_json,
        created_at,
        updated_at
      ) VALUES (
        :id,
        :user_id,
        :ai_provider,
        :ai_model,
        :encrypted_api_key,
        '[]',
        SYSTIMESTAMP,
        SYSTIMESTAMP
      )
    `,
    {
      id: input.userId,
      user_id: input.userId,
      ai_provider: input.provider,
      ai_model: input.model,
      encrypted_api_key: input.encryptedApiKey ?? null,
    }
  );
}

export async function saveOracleFavoritePersonas(userId: string, favorites: string[]): Promise<void> {
  await run(
    `
      MERGE INTO user_settings tgt
      USING (
        SELECT
          :user_id AS user_id,
          :favorites_json AS favorites_json
        FROM dual
      ) src
      ON (tgt.user_id = src.user_id)
      WHEN MATCHED THEN
        UPDATE SET
          favorite_personas_json = src.favorites_json,
          updated_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (
          id,
          user_id,
          ai_provider,
          ai_model,
          favorite_personas_json,
          created_at,
          updated_at
        )
        VALUES (
          :id,
          src.user_id,
          'openai',
          'gpt-4o',
          src.favorites_json,
          SYSTIMESTAMP,
          SYSTIMESTAMP
        )
    `,
    {
      id: userId,
      user_id: userId,
      favorites_json: JSON.stringify(favorites),
    }
  );
}

export async function listOracleChatsByPersona(userId: string, personaId: string): Promise<Chat[]> {
  await ensureChatParticipantsSchema();
  const rows = await run<Record<string, unknown>>(
    `
      SELECT id, user_id, persona_id, title, created_at
      FROM chats c
      WHERE c.user_id = :user_id
        AND EXISTS (
          SELECT 1
          FROM chat_participants cp
          WHERE cp.chat_id = c.id
            AND cp.persona_id = :persona_id
        )
      ORDER BY created_at DESC
    `,
    {
      user_id: userId,
      persona_id: personaId,
    }
  );

  return rows.map(mapChat);
}

export async function listOracleChatsByUser(userId: string): Promise<Chat[]> {
  await ensureChatParticipantsSchema();
  const rows = await run<Record<string, unknown>>(
    `
      SELECT id, user_id, persona_id, title, created_at
      FROM chats
      WHERE user_id = :user_id
      ORDER BY created_at DESC
    `,
    { user_id: userId }
  );
  return rows.map(mapChat);
}

export async function getOracleChatById(chatId: string): Promise<Chat | null> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT id, user_id, persona_id, title, created_at
      FROM chats
      WHERE id = :id
      FETCH FIRST 1 ROWS ONLY
    `,
    { id: chatId }
  );

  const row = rows[0];
  return row ? mapChat(row) : null;
}

export async function listOracleChatParticipants(
  chatId: string
): Promise<Pick<Persona, "id" | "slug" | "name" | "image_url">[]> {
  await ensureChatParticipantsSchema();
  const rows = await run<Record<string, unknown>>(
    `
      SELECT p.id, p.slug, p.name, p.image_url
      FROM chat_participants cp
      JOIN personas p ON p.id = cp.persona_id
      WHERE cp.chat_id = :chat_id
      ORDER BY p.name
    `,
    { chat_id: chatId }
  );
  return rows.map((row) => ({
    id: asText(row.ID ?? row.id),
    slug: asText(row.SLUG ?? row.slug),
    name: asText(row.NAME ?? row.name),
    image_url: (row.IMAGE_URL ?? row.image_url) as string | null,
  }));
}

export async function createOracleChat(input: {
  userId: string;
  personaId?: string;
  personaIds?: string[];
  title: string;
}): Promise<Chat> {
  await ensureChatParticipantsSchema();
  const participantIds = (input.personaIds || []).filter(Boolean);
  const primaryPersonaId = input.personaId || participantIds[0];
  if (!primaryPersonaId) throw new Error("At least one persona is required");

  const id = randomUUID();
  await run(
    `
      INSERT INTO chats (id, user_id, persona_id, title, created_at)
      VALUES (:id, :user_id, :persona_id, :title, SYSTIMESTAMP)
    `,
    {
      id,
      user_id: input.userId,
      persona_id: primaryPersonaId,
      title: input.title,
    }
  );

  const allParticipantIds = participantIds.length > 0 ? participantIds : [primaryPersonaId];
  for (const personaId of allParticipantIds) {
    await run(
      `
        MERGE INTO chat_participants cp
        USING (SELECT :chat_id AS chat_id, :persona_id AS persona_id FROM dual) src
        ON (cp.chat_id = src.chat_id AND cp.persona_id = src.persona_id)
        WHEN NOT MATCHED THEN
          INSERT (chat_id, persona_id, created_at)
          VALUES (src.chat_id, src.persona_id, SYSTIMESTAMP)
      `,
      { chat_id: id, persona_id: personaId }
    );
  }

  return {
    id,
    user_id: input.userId,
    persona_id: primaryPersonaId,
    title: input.title,
    created_at: new Date().toISOString(),
  };
}

export async function updateOracleChatTitle(chatId: string, title: string): Promise<void> {
  await run(
    `
      UPDATE chats
      SET title = :title
      WHERE id = :id
    `,
    {
      id: chatId,
      title,
    }
  );
}

export async function deleteOracleChat(chatId: string): Promise<void> {
  await run(`DELETE FROM chats WHERE id = :id`, { id: chatId });
}

export async function listOracleMessagesByChat(chatId: string): Promise<Message[]> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT id, chat_id, role, content, created_at
      FROM messages
      WHERE chat_id = :chat_id
      ORDER BY created_at ASC
    `,
    { chat_id: chatId }
  );

  return rows.map(mapMessage);
}

export async function createOracleMessage(input: {
  chatId: string;
  role: Message["role"];
  content: string;
}): Promise<Message> {
  const id = randomUUID();
  await run(
    `
      INSERT INTO messages (id, chat_id, role, content, created_at)
      VALUES (:id, :chat_id, :role, :content, SYSTIMESTAMP)
    `,
    {
      id,
      chat_id: input.chatId,
      role: input.role,
      content: input.content,
    }
  );

  return {
    id,
    chat_id: input.chatId,
    role: input.role,
    content: input.content,
    created_at: new Date().toISOString(),
  };
}

export async function getOracleMessageById(messageId: string): Promise<Message | null> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT id, chat_id, role, content, created_at
      FROM messages
      WHERE id = :id
      FETCH FIRST 1 ROWS ONLY
    `,
    { id: messageId }
  );

  const row = rows[0];
  return row ? mapMessage(row) : null;
}

export async function deleteOracleMessage(messageId: string): Promise<void> {
  await run(`DELETE FROM messages WHERE id = :id`, { id: messageId });
}

export async function deleteOracleUserData(userId: string): Promise<void> {
  await run(`DELETE FROM chats WHERE user_id = :user_id`, { user_id: userId });
  await run(`DELETE FROM user_settings WHERE user_id = :user_id`, { user_id: userId });
}

export async function getOracleRelevantChunks(
  personaId: string,
  queryEmbedding: number[],
  count: number
): Promise<{ content: string; metadata: Record<string, unknown>; similarity: number }[]> {
  const safeCount = Math.max(1, Math.min(20, Math.floor(count)));
  const embeddingLiteral = JSON.stringify(queryEmbedding);

  const rows = await run<Record<string, unknown>>(
    `
      SELECT
        content,
        metadata_json,
        1 - VECTOR_DISTANCE(embedding, TO_VECTOR(:query_embedding), COSINE) AS similarity
      FROM document_chunks
      WHERE persona_id = :persona_id
      ORDER BY VECTOR_DISTANCE(embedding, TO_VECTOR(:query_embedding), COSINE)
      FETCH FIRST ${safeCount} ROWS ONLY
    `,
    {
      persona_id: personaId,
      query_embedding: embeddingLiteral,
    }
  );

  return rows.map((row) => ({
    content: asText(row.CONTENT ?? row.content),
    metadata: parseJsonObject(row.METADATA_JSON ?? row.metadata_json),
    similarity: Number(row.SIMILARITY ?? row.similarity ?? 0),
  }));
}

export async function insertOracleDocumentChunk(input: {
  personaId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}): Promise<void> {
  await run(
    `
      INSERT INTO document_chunks (id, persona_id, content, embedding, metadata_json, created_at)
      VALUES (
        :id,
        :persona_id,
        :content,
        TO_VECTOR(:embedding),
        :metadata_json,
        SYSTIMESTAMP
      )
    `,
    {
      id: randomUUID(),
      persona_id: input.personaId,
      content: input.content,
      embedding: JSON.stringify(input.embedding),
      metadata_json: JSON.stringify(input.metadata || {}),
    }
  );
}

export async function hasOracleDocumentChunkBySourceKey(
  personaId: string,
  sourceKey: string
): Promise<boolean> {
  const rows = await run<Record<string, unknown>>(
    `
      SELECT id
      FROM document_chunks
      WHERE persona_id = :persona_id
        AND JSON_VALUE(metadata_json, '$.source_key') = :source_key
      FETCH FIRST 1 ROWS ONLY
    `,
    {
      persona_id: personaId,
      source_key: sourceKey,
    }
  );

  return rows.length > 0;
}

export async function createOraclePersona(input: {
  name: string;
  slug: string;
  bio?: string;
}): Promise<Persona> {
  const id = randomUUID();
  await run(
    `
      INSERT INTO personas (
        id,
        slug,
        name,
        bio,
        expertise_json,
        books_json,
        podcasts_json,
        image_url,
        conversation_starters_json,
        created_at
      ) VALUES (
        :id,
        :slug,
        :name,
        :bio,
        '[]',
        '[]',
        '[]',
        NULL,
        '[]',
        SYSTIMESTAMP
      )
    `,
    {
      id,
      slug: input.slug,
      name: input.name,
      bio: input.bio || "",
    }
  );

  const persona = await getOraclePersonaById(id);
  if (!persona) throw new Error("Failed to create persona");
  return persona;
}

export async function updateOraclePersonaMetadata(input: {
  personaId: string;
  name?: string;
  bio?: string;
  expertise?: string[];
  books?: Array<{ title: string; year?: number; description?: string }>;
  podcasts?: Array<{ title: string; url?: string; platform?: string }>;
  conversationStarters?: string[];
  imageUrl?: string;
}): Promise<void> {
  await run(
    `
      UPDATE personas
      SET
        name = COALESCE(:name, name),
        bio = :bio,
        expertise_json = :expertise_json,
        books_json = :books_json,
        podcasts_json = :podcasts_json,
        conversation_starters_json = :conversation_starters_json,
        image_url = COALESCE(:image_url, image_url)
      WHERE id = :id
    `,
    {
      id: input.personaId,
      name: input.name,
      bio: input.bio || "",
      expertise_json: JSON.stringify(input.expertise || []),
      books_json: JSON.stringify(input.books || []),
      podcasts_json: JSON.stringify(input.podcasts || []),
      conversation_starters_json: JSON.stringify(input.conversationStarters || []),
      image_url: input.imageUrl,
    }
  );
}

export async function updateOraclePersonaImageUrl(personaId: string, imageUrl: string): Promise<void> {
  await run(
    `
      UPDATE personas
      SET image_url = :image_url
      WHERE id = :id
    `,
    {
      id: personaId,
      image_url: imageUrl,
    }
  );
}

export async function createOraclePersonaIngestJob(input: {
  userId: string;
  personaId: string;
  query: string;
  sources: {
    books: boolean;
    podcasts: boolean;
    youtube: boolean;
    blogs: boolean;
    interviews: boolean;
    social: boolean;
  };
  stats?: Record<string, unknown>;
}): Promise<PersonaIngestJob> {
  await ensurePersonaIngestSchema();
  const id = randomUUID();
  await run(
    `
      INSERT INTO persona_ingest_jobs (
        id,
        user_id,
        persona_id,
        query,
        sources_json,
        status,
        step,
        progress_percent,
        stats_json,
        created_at,
        updated_at
      ) VALUES (
        :id,
        :user_id,
        :persona_id,
        :query,
        :sources_json,
        'queued',
        'Queued',
        0,
        :stats_json,
        SYSTIMESTAMP,
        SYSTIMESTAMP
      )
    `,
    {
      id,
      user_id: input.userId,
      persona_id: input.personaId,
      query: input.query,
      sources_json: JSON.stringify(input.sources),
      stats_json: JSON.stringify(input.stats || {}),
    }
  );
  const row = await getOraclePersonaIngestJobById(id);
  if (!row) throw new Error("Failed to create ingest job");
  return row;
}

export async function listOraclePersonaIngestJobs(userId: string): Promise<PersonaIngestJob[]> {
  await ensurePersonaIngestSchema();
  const rows = await run<Record<string, unknown>>(
    `
      SELECT
        j.id,
        j.user_id,
        j.persona_id,
        j.query,
        j.sources_json,
        j.status,
        j.step,
        j.progress_percent,
        j.stats_json,
        j.error_message,
        j.created_at,
        j.updated_at,
        j.started_at,
        j.completed_at,
        p.name AS persona_name,
        p.slug AS persona_slug
      FROM persona_ingest_jobs j
      JOIN personas p ON p.id = j.persona_id
      WHERE j.user_id = :user_id
      ORDER BY j.created_at DESC
      FETCH FIRST 25 ROWS ONLY
    `,
    { user_id: userId }
  );
  return rows.map(mapPersonaIngestJob);
}

export async function getOraclePersonaIngestJobById(
  jobId: string
): Promise<PersonaIngestJob | null> {
  await ensurePersonaIngestSchema();
  const rows = await run<Record<string, unknown>>(
    `
      SELECT
        j.id,
        j.user_id,
        j.persona_id,
        j.query,
        j.sources_json,
        j.status,
        j.step,
        j.progress_percent,
        j.stats_json,
        j.error_message,
        j.created_at,
        j.updated_at,
        j.started_at,
        j.completed_at,
        p.name AS persona_name,
        p.slug AS persona_slug
      FROM persona_ingest_jobs j
      JOIN personas p ON p.id = j.persona_id
      WHERE j.id = :id
      FETCH FIRST 1 ROWS ONLY
    `,
    { id: jobId }
  );
  const row = rows[0];
  return row ? mapPersonaIngestJob(row) : null;
}

export async function updateOraclePersonaIngestJob(input: {
  id: string;
  status?: PersonaIngestJob["status"];
  step?: string;
  progressPercent?: number;
  stats?: Record<string, unknown>;
  errorMessage?: string | null;
  started?: boolean;
  completed?: boolean;
}): Promise<void> {
  await ensurePersonaIngestSchema();
  const binds: oracledb.BindParameters = {
    id: input.id,
    status: input.status,
    step: input.step,
    progress_percent:
      input.progressPercent === undefined ? undefined : Number(input.progressPercent.toFixed(2)),
    error_message: input.errorMessage ?? null,
    started: input.started ? 1 : 0,
    completed: input.completed ? 1 : 0,
  };

  const statsClause =
    input.stats === undefined ? "" : ", stats_json = :stats_json";
  if (input.stats !== undefined) {
    binds.stats_json = JSON.stringify(input.stats);
  }

  await run(
    `
      UPDATE persona_ingest_jobs
      SET
        status = COALESCE(:status, status),
        step = COALESCE(:step, step),
        progress_percent = COALESCE(:progress_percent, progress_percent)
        ${statsClause},
        error_message = :error_message,
        started_at = CASE
          WHEN :started = 1 AND started_at IS NULL THEN SYSTIMESTAMP
          ELSE started_at
        END,
        completed_at = CASE
          WHEN :completed = 1 THEN SYSTIMESTAMP
          ELSE completed_at
        END,
        updated_at = SYSTIMESTAMP
      WHERE id = :id
    `,
    binds
  );
}

export async function deleteOraclePersona(personaId: string): Promise<void> {
  await run(`DELETE FROM chats WHERE persona_id = :persona_id`, { persona_id: personaId });
  await run(`DELETE FROM personas WHERE id = :id`, { id: personaId });
}

export async function getOracleChunkCountsByPersonaIds(
  personaIds: string[]
): Promise<Record<string, number>> {
  if (personaIds.length === 0) return {};

  const binds: oracledb.BindParameters = {};
  const placeholders: string[] = [];
  for (let i = 0; i < personaIds.length; i++) {
    const key = `persona_id_${i}`;
    binds[key] = personaIds[i];
    placeholders.push(`:${key}`);
  }

  const rows = await run<Record<string, unknown>>(
    `
      SELECT persona_id, COUNT(*) AS chunk_count
      FROM document_chunks
      WHERE persona_id IN (${placeholders.join(", ")})
      GROUP BY persona_id
    `,
    binds
  );

  const result: Record<string, number> = {};
  for (const row of rows) {
    const personaId = asText(row.PERSONA_ID ?? row.persona_id);
    result[personaId] = Number(row.CHUNK_COUNT ?? row.chunk_count ?? 0);
  }
  return result;
}
