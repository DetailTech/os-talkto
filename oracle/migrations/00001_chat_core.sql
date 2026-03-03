-- Oracle ADB-S full schema for Talk-To local auth + RAG

CREATE TABLE personas (
  id VARCHAR2(36) PRIMARY KEY,
  slug VARCHAR2(200) UNIQUE NOT NULL,
  name VARCHAR2(300) NOT NULL,
  bio CLOB,
  expertise_json CLOB CHECK (expertise_json IS JSON),
  books_json CLOB CHECK (books_json IS JSON),
  podcasts_json CLOB CHECK (podcasts_json IS JSON),
  image_url VARCHAR2(1024),
  conversation_starters_json CLOB CHECK (conversation_starters_json IS JSON),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE user_settings (
  id VARCHAR2(36) PRIMARY KEY,
  user_id VARCHAR2(36) NOT NULL UNIQUE,
  ai_provider VARCHAR2(40) NOT NULL,
  ai_model VARCHAR2(200) NOT NULL,
  encrypted_api_key CLOB,
  favorite_personas_json CLOB CHECK (favorite_personas_json IS JSON),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE chats (
  id VARCHAR2(36) PRIMARY KEY,
  user_id VARCHAR2(36) NOT NULL,
  persona_id VARCHAR2(36) NOT NULL,
  title VARCHAR2(500) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT fk_chats_persona FOREIGN KEY (persona_id) REFERENCES personas(id)
);

CREATE INDEX idx_chats_user_persona ON chats(user_id, persona_id);
CREATE INDEX idx_chats_user_created ON chats(user_id, created_at DESC);

CREATE TABLE messages (
  id VARCHAR2(36) PRIMARY KEY,
  chat_id VARCHAR2(36) NOT NULL,
  role VARCHAR2(20) NOT NULL,
  content CLOB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT fk_messages_chat FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  CONSTRAINT chk_messages_role CHECK (role IN ('user', 'assistant', 'system'))
);

CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at);

CREATE TABLE document_chunks (
  id VARCHAR2(36) PRIMARY KEY,
  persona_id VARCHAR2(36) NOT NULL,
  content CLOB NOT NULL,
  embedding VECTOR(1536, FLOAT32) NOT NULL,
  metadata_json CLOB CHECK (metadata_json IS JSON),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT fk_document_chunks_persona FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
);

CREATE INDEX idx_document_chunks_persona ON document_chunks(persona_id);

-- Example similarity query used by app:
-- SELECT content, metadata_json,
--   1 - VECTOR_DISTANCE(embedding, TO_VECTOR(:query_embedding), COSINE) AS similarity
-- FROM document_chunks
-- WHERE persona_id = :persona_id
-- ORDER BY VECTOR_DISTANCE(embedding, TO_VECTOR(:query_embedding), COSINE)
-- FETCH FIRST 8 ROWS ONLY;

-- Seed persona: Rob Walling
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
  '11111111-1111-1111-1111-111111111111',
  'rob-walling',
  'Rob Walling',
  'Serial SaaS entrepreneur, author, and founder of MicroConf and TinySeed.',
  '["SaaS","Bootstrapping","Startup Funding","Product-Market Fit","Indie Hacking"]',
  '[{"title":"The SaaS Playbook","year":2023},{"title":"Start Small, Stay Small","year":2010}]',
  '[{"title":"Startups For the Rest of Us","url":"https://www.startupsfortherestofus.com/","platform":"Podcast"}]',
  NULL,
  '["What is your PMF framework?","How should I price my SaaS?","When should founders bootstrap vs raise?"]',
  SYSTIMESTAMP
);
