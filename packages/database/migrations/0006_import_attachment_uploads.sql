CREATE TABLE import_attachment_uploads (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  upload_id uuid NOT NULL,
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  PRIMARY KEY(project_id, id),
  UNIQUE(project_id, actor_user_id, upload_id)
);
CREATE TRIGGER import_attachment_uploads_append_only BEFORE UPDATE OR DELETE ON import_attachment_uploads
  FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
