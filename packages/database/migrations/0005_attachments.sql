CREATE TABLE attachments (
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 1023),
  storage_provider text NOT NULL CHECK (storage_provider ~ '^[a-z0-9-]{1,64}$'),
  storage_key text NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 1024 AND storage_key ~ '^[a-zA-Z0-9/_-]+$'),
  storage_version text NOT NULL CHECK (length(storage_version) BETWEEN 1 AND 255),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  PRIMARY KEY (project_id, id),
  CONSTRAINT attachments_message_ordinal_uq UNIQUE (project_id, message_id, ordinal),
  CONSTRAINT attachments_storage_uq UNIQUE (storage_provider, storage_key, storage_version),
  CONSTRAINT attachments_message_fk FOREIGN KEY (project_id, conversation_id, message_id)
    REFERENCES messages(project_id, conversation_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT attachments_checksum_check CHECK (
    (evidence->'checksum'->>'algorithm' = 'sha256' AND evidence->'checksum'->>'value' ~ '^[a-f0-9]{64}$') IS TRUE),
  CONSTRAINT attachments_size_check CHECK (
    (jsonb_typeof(evidence->'byteSize') = 'number' AND (evidence->>'byteSize')::numeric BETWEEN 0 AND 9007199254740991
      AND (evidence->>'byteSize')::numeric = trunc((evidence->>'byteSize')::numeric)) IS TRUE),
  CONSTRAINT attachments_kind_check CHECK ((evidence->>'mediaKind' IN ('image', 'video', 'model', 'binary')) IS TRUE)
);
CREATE INDEX attachments_conversation_idx ON attachments(project_id, conversation_id);

CREATE FUNCTION cce_guard_attachment_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM messages WHERE project_id = NEW.project_id AND id = NEW.message_id) THEN
    RAISE EXCEPTION 'attachments must precede their new message in the same transaction' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER attachments_binding_guard BEFORE INSERT ON attachments
  FOR EACH ROW EXECUTE FUNCTION cce_guard_attachment_binding();
CREATE TRIGGER attachments_append_only BEFORE UPDATE OR DELETE ON attachments
  FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();

CREATE TABLE attachment_events (
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  PRIMARY KEY(project_id, id),
  CONSTRAINT attachment_events_sequence_uq UNIQUE(project_id, attachment_id, sequence),
  FOREIGN KEY(project_id, attachment_id) REFERENCES attachments(project_id, id) ON DELETE RESTRICT,
  CHECK ((detail->>'processingStatus' IN ('pending', 'processing', 'succeeded', 'failed')) IS TRUE),
  CHECK ((detail->>'availability' IN ('available', 'quarantined', 'unavailable', 'deprecated')) IS TRUE)
);
CREATE TRIGGER attachment_events_append_only BEFORE UPDATE OR DELETE ON attachment_events
  FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
