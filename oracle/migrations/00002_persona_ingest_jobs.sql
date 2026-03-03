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
);

CREATE INDEX idx_ingest_jobs_user_created ON persona_ingest_jobs(user_id, created_at DESC);
CREATE INDEX idx_ingest_jobs_status ON persona_ingest_jobs(status, updated_at DESC);
