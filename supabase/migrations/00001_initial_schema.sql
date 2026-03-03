-- Enable pgvector extension for RAG vector search
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- PERSONAS TABLE
-- ============================================
CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  expertise TEXT[] NOT NULL DEFAULT '{}',
  books_json JSONB NOT NULL DEFAULT '[]',
  podcasts_json JSONB NOT NULL DEFAULT '[]',
  image_url TEXT,
  conversation_starters TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Public read access to personas
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Personas are publicly readable" ON personas
  FOR SELECT USING (true);

-- ============================================
-- DOCUMENT CHUNKS TABLE (RAG)
-- ============================================
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON document_chunks (persona_id);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Document chunks are publicly readable" ON document_chunks
  FOR SELECT USING (true);
-- Only service role can insert/update/delete document_chunks (admin upload)

-- ============================================
-- CHATS TABLE
-- ============================================
CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON chats (user_id, persona_id);
CREATE INDEX ON chats (user_id, created_at DESC);

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own chats" ON chats
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chats" ON chats
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own chats" ON chats
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own chats" ON chats
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- MESSAGES TABLE
-- ============================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON messages (chat_id, created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view messages of own chats" ON messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid())
  );
CREATE POLICY "Users can insert messages to own chats" ON messages
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid())
  );

-- ============================================
-- USER SETTINGS TABLE
-- ============================================
CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_provider TEXT NOT NULL DEFAULT 'openai',
  ai_model TEXT NOT NULL DEFAULT 'gpt-4o',
  encrypted_api_key TEXT,
  favorite_personas UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- VECTOR SIMILARITY SEARCH FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_persona_id UUID,
  match_count INT DEFAULT 8
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    document_chunks.id,
    document_chunks.content,
    document_chunks.metadata,
    1 - (document_chunks.embedding <=> query_embedding) AS similarity
  FROM document_chunks
  WHERE document_chunks.persona_id = match_persona_id
  ORDER BY document_chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================
-- AUTO-CREATE USER SETTINGS ON SIGNUP
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- SEED: Rob Walling persona
-- ============================================
INSERT INTO personas (slug, name, bio, expertise, books_json, podcasts_json, image_url, conversation_starters)
VALUES (
  'rob-walling',
  'Rob Walling',
  'Serial SaaS entrepreneur, author, and founder of MicroConf and TinySeed. Rob has built and sold multiple software companies and is one of the leading voices in the bootstrapped/indie SaaS community. He''s the author of "The SaaS Playbook" and "Start Small, Stay Small" and hosts the Startups For the Rest of Us podcast.',
  ARRAY['SaaS', 'Bootstrapping', 'Startup Funding', 'Product-Market Fit', 'Indie Hacking', 'MicroConf', 'TinySeed'],
  '[
    {"title": "The SaaS Playbook", "year": 2023, "description": "Build a multimillion-dollar startup without venture capital"},
    {"title": "Start Small, Stay Small", "year": 2010, "description": "A developer''s guide to launching a startup"}
  ]'::jsonb,
  '[
    {"title": "Startups For the Rest of Us", "url": "https://www.startupsfortherestofus.com/", "platform": "Podcast"},
    {"title": "MicroConf Talks", "url": "https://www.youtube.com/@MicroConf", "platform": "YouTube"}
  ]'::jsonb,
  NULL,
  ARRAY[
    'What''s your framework for finding product-market fit in a SaaS?',
    'How should I think about pricing my SaaS product?',
    'What are the biggest mistakes bootstrapped founders make?',
    'When does it make sense to take funding vs. bootstrap?',
    'How do you approach building a repeatable customer acquisition channel?'
  ]
);

-- Placeholder: Add real document chunks for Rob Walling
-- To add real content, chunk your PDFs/transcripts into ~500 token segments
-- and generate embeddings using OpenAI text-embedding-3-small, then insert:
--
-- INSERT INTO document_chunks (persona_id, content, embedding, metadata)
-- VALUES (
--   (SELECT id FROM personas WHERE slug = 'rob-walling'),
--   'Your chunk text here...',
--   '[0.001, 0.002, ...]'::vector(1536),
--   '{"source": "The SaaS Playbook", "chapter": "1"}'::jsonb
-- );
