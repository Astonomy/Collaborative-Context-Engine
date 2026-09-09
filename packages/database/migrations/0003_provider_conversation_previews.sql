CREATE TABLE conversation_import_previews (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  source text NOT NULL,
  source_file_hash char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  message_count integer NOT NULL,
  unsupported_content_count integer NOT NULL,
  warnings jsonb NOT NULL,
  conversation jsonb NOT NULL,
  CONSTRAINT conversation_import_previews_pk PRIMARY KEY (project_id, id),
  CONSTRAINT conversation_import_previews_source CHECK (source IN ('chatgpt-plugin', 'codex-plugin')),
  CONSTRAINT conversation_import_previews_hash_format CHECK (source_file_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT conversation_import_previews_counts_nonnegative CHECK (message_count >= 0 AND unsupported_content_count >= 0),
  CONSTRAINT conversation_import_previews_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT conversation_import_previews_json_shape CHECK (jsonb_typeof(warnings) = 'array' AND jsonb_typeof(conversation) = 'object')
);

CREATE INDEX conversation_import_previews_expiry_idx
ON conversation_import_previews (expires_at);

ALTER TABLE conversation_imports
  ADD CONSTRAINT conversation_imports_source
    CHECK (source IN ('chatgpt', 'chatgpt-plugin', 'codex-plugin')),
  ADD CONSTRAINT conversation_imports_source_format
    CHECK (source_format IN ('json', 'zip', 'mcp')),
  ADD CONSTRAINT conversation_imports_policy
    CHECK (policy IN ('current_path', 'provided_messages')),
  ADD CONSTRAINT conversation_imports_source_shape
    CHECK (
      (source = 'chatgpt' AND source_format IN ('json', 'zip') AND policy = 'current_path')
      OR
      (source IN ('chatgpt-plugin', 'codex-plugin') AND source_format = 'mcp' AND policy = 'provided_messages')
    ),
  ADD CONSTRAINT conversation_imports_completed_status CHECK (status = 'completed'),
  ADD CONSTRAINT conversation_imports_json_shape
    CHECK (
      jsonb_typeof(warnings) = 'array'
      AND jsonb_typeof(source_manifest) = 'array'
      AND jsonb_typeof(imported_conversations) = 'array'
    );

CREATE FUNCTION cce_reject_conversation_import_preview_update() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'conversation import previews cannot be updated' USING ERRCODE = '55000'; END; $$;
CREATE TRIGGER conversation_import_previews_no_update BEFORE UPDATE ON conversation_import_previews
FOR EACH ROW EXECUTE FUNCTION cce_reject_conversation_import_preview_update();
