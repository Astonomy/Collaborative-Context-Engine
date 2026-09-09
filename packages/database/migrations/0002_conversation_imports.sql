CREATE TABLE conversation_imports (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL, source text NOT NULL, source_format text NOT NULL,
  source_file_hash char(64) NOT NULL, policy text NOT NULL, status text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL, completed_at timestamptz NOT NULL,
  conversation_count integer NOT NULL, message_count integer NOT NULL,
  warnings jsonb NOT NULL, source_manifest jsonb NOT NULL, imported_conversations jsonb NOT NULL,
  CONSTRAINT conversation_imports_pk PRIMARY KEY (project_id, id),
  CONSTRAINT conversation_imports_identity_uq UNIQUE (project_id, source_file_hash, policy),
  CONSTRAINT conversation_imports_hash_format CHECK (source_file_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT conversation_imports_counts_nonnegative CHECK (conversation_count >= 0 AND message_count >= 0)
);
CREATE FUNCTION cce_reject_conversation_import_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'conversation imports are append-only' USING ERRCODE = '55000'; END; $$;
CREATE TRIGGER conversation_imports_append_only BEFORE UPDATE OR DELETE ON conversation_imports
FOR EACH ROW EXECUTE FUNCTION cce_reject_conversation_import_mutation();
