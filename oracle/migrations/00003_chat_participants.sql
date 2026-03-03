CREATE TABLE chat_participants (
  chat_id VARCHAR2(36) NOT NULL,
  persona_id VARCHAR2(36) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT pk_chat_participants PRIMARY KEY (chat_id, persona_id),
  CONSTRAINT fk_chat_participants_chat FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_participants_persona FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_participants_persona ON chat_participants(persona_id);

INSERT INTO chat_participants (chat_id, persona_id, created_at)
SELECT c.id, c.persona_id, SYSTIMESTAMP
FROM chats c
WHERE NOT EXISTS (
  SELECT 1
  FROM chat_participants cp
  WHERE cp.chat_id = c.id
    AND cp.persona_id = c.persona_id
);
