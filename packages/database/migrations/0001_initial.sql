CREATE TYPE project_role AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE conversation_status AS ENUM ('active', 'archived');
CREATE TYPE branch_status AS ENUM ('open', 'merged', 'abandoned');
CREATE TYPE message_role AS ENUM ('system', 'user', 'assistant', 'tool');
CREATE TYPE message_delivery_state AS ENUM ('pending', 'streaming', 'completed', 'interrupted', 'failed');
CREATE TYPE context_commit_kind AS ENUM ('genesis', 'semantic');
CREATE TYPE context_operation AS ENUM ('add', 'update', 'supersede', 'deprecate');
CREATE TYPE context_item_kind AS ENUM (
  'fact', 'decision', 'requirement', 'assumption', 'constraint', 'task',
  'question', 'risk', 'artifact', 'preference', 'rejected_option', 'architecture'
);
CREATE TYPE context_item_lifecycle AS ENUM ('active', 'deprecated', 'superseded');
CREATE TYPE context_item_authority AS ENUM ('authoritative', 'alternative');
CREATE TYPE conflict_classification AS ENUM ('duplicate', 'C0', 'C1', 'C2', 'C3', 'C4');
CREATE TYPE merge_request_status AS ENUM ('draft', 'reviewing', 'ready', 'committed', 'rejected', 'stale');
CREATE TYPE merge_finalization_outcome AS ENUM ('committed', 'no_changes');
CREATE TYPE model_run_status AS ENUM ('running', 'completed', 'failed', 'interrupted');
CREATE TYPE model_run_purpose AS ENUM ('chat', 'extraction', 'classification', 'agent');
CREATE TYPE agent_run_status AS ENUM ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled');
CREATE TYPE agent_name AS ENUM ('manager', 'extractor', 'research', 'review', 'merge');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT users_email_not_blank CHECK (length(btrim(email)) > 0),
  CONSTRAINT users_display_name_not_blank CHECK (length(btrim(display_name)) > 0)
);
CREATE UNIQUE INDEX users_email_normalized_uq ON users (lower(email));

CREATE TABLE api_tokens (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT api_tokens_hash_sha256 CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT api_tokens_label_not_blank CHECK (length(btrim(label)) > 0)
);
CREATE INDEX api_tokens_user_idx ON api_tokens(user_id);

CREATE TABLE projects (
  project_id uuid PRIMARY KEY,
  name text NOT NULL,
  head_commit_id uuid NOT NULL,
  version integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  archived_at timestamptz,
  CONSTRAINT projects_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT projects_version_nonnegative CHECK (version >= 0)
);

CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role project_role NOT NULL,
  joined_at timestamptz NOT NULL,
  CONSTRAINT project_members_pk PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members(user_id, project_id);

CREATE FUNCTION cce_guard_last_project_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR NEW.role <> 'owner') THEN
    PERFORM 1 FROM projects WHERE project_id = OLD.project_id FOR UPDATE;
    IF NOT EXISTS (
      SELECT 1 FROM project_members
      WHERE project_id = OLD.project_id
        AND user_id <> OLD.user_id
        AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'a project must retain at least one owner' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_members_last_owner_guard
  BEFORE UPDATE OF role OR DELETE ON project_members
  FOR EACH ROW EXECUTE FUNCTION cce_guard_last_project_owner();

CREATE TABLE context_commits (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  kind context_commit_kind NOT NULL,
  parent_commit_id uuid,
  version integer NOT NULL,
  idempotency_key text NOT NULL,
  summary text NOT NULL,
  proposed_by jsonb NOT NULL,
  committed_by jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT context_commits_pk PRIMARY KEY (project_id, id),
  CONSTRAINT context_commits_project_version_uq UNIQUE (project_id, version),
  CONSTRAINT context_commits_idempotency_uq UNIQUE (project_id, idempotency_key),
  CONSTRAINT context_commits_parent_fk FOREIGN KEY (project_id, parent_commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_commits_version_nonnegative CHECK (version >= 0),
  CONSTRAINT context_commits_idempotency_not_blank CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT context_commits_summary_not_blank CHECK (length(btrim(summary)) > 0),
  CONSTRAINT context_commits_shape CHECK (
    (kind = 'genesis' AND parent_commit_id IS NULL AND version = 0)
    OR (kind = 'semantic' AND parent_commit_id IS NOT NULL AND version > 0)
  )
);

ALTER TABLE projects
  ADD CONSTRAINT projects_head_commit_fk
  FOREIGN KEY (project_id, head_commit_id)
  REFERENCES context_commits(project_id, id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE conversations (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  branch_id uuid NOT NULL,
  title text NOT NULL,
  status conversation_status NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  archived_at timestamptz,
  CONSTRAINT conversations_pk PRIMARY KEY (project_id, id),
  CONSTRAINT conversations_project_branch_uq UNIQUE (project_id, branch_id),
  CONSTRAINT conversations_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT conversations_archive_state CHECK (
    (status = 'active' AND archived_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL)
  )
);

CREATE TABLE branches (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  base_commit_id uuid NOT NULL,
  status branch_status NOT NULL,
  created_at timestamptz NOT NULL,
  closed_at timestamptz,
  CONSTRAINT branches_pk PRIMARY KEY (project_id, id),
  CONSTRAINT branches_project_conversation_uq UNIQUE (project_id, conversation_id),
  CONSTRAINT branches_project_id_conversation_uq UNIQUE (project_id, id, conversation_id),
  CONSTRAINT branches_project_id_conversation_base_uq UNIQUE (
    project_id, id, conversation_id, base_commit_id
  ),
  CONSTRAINT branches_conversation_fk FOREIGN KEY (project_id, conversation_id)
    REFERENCES conversations(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT branches_base_commit_fk FOREIGN KEY (project_id, base_commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT branches_close_state CHECK (
    (status = 'open' AND closed_at IS NULL)
    OR (status <> 'open' AND closed_at IS NOT NULL)
  )
);

ALTER TABLE conversations
  ADD CONSTRAINT conversations_branch_fk
  FOREIGN KEY (project_id, branch_id)
  REFERENCES branches(project_id, id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE messages (
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  sequence integer NOT NULL,
  client_message_id uuid,
  reply_to_message_id uuid,
  role message_role NOT NULL,
  delivery_state message_delivery_state NOT NULL,
  content text NOT NULL,
  author jsonb NOT NULL,
  provider_message_id text,
  error_code text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT messages_pk PRIMARY KEY (project_id, id),
  CONSTRAINT messages_project_conversation_id_uq UNIQUE (project_id, conversation_id, id),
  CONSTRAINT messages_sequence_uq UNIQUE (project_id, conversation_id, sequence),
  CONSTRAINT messages_client_id_uq UNIQUE (project_id, conversation_id, client_message_id),
  CONSTRAINT messages_conversation_fk FOREIGN KEY (project_id, conversation_id)
    REFERENCES conversations(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT messages_reply_to_message_fk FOREIGN KEY (
    project_id, conversation_id, reply_to_message_id
  ) REFERENCES messages(project_id, conversation_id, id) ON DELETE RESTRICT,
  CONSTRAINT messages_sequence_positive CHECK (sequence > 0),
  CONSTRAINT messages_terminal_state CHECK (
    (delivery_state IN ('completed', 'interrupted', 'failed')) = (completed_at IS NOT NULL)
  ),
  CONSTRAINT messages_completed_content CHECK (delivery_state <> 'completed' OR length(btrim(content)) > 0),
  CONSTRAINT messages_user_client_id CHECK (role <> 'user' OR client_message_id IS NOT NULL),
  CONSTRAINT messages_reply_role CHECK (reply_to_message_id IS NULL OR role = 'assistant')
);

CREATE UNIQUE INDEX messages_reply_to_message_uq
  ON messages(project_id, conversation_id, reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

CREATE TABLE model_runs (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  conversation_id uuid,
  provider text NOT NULL,
  model text NOT NULL,
  purpose model_run_purpose NOT NULL,
  prompt_id text NOT NULL,
  prompt_version integer NOT NULL,
  input_hash char(64) NOT NULL,
  status model_run_status NOT NULL,
  input_tokens integer,
  cached_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error_code text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT model_runs_pk PRIMARY KEY (project_id, id),
  CONSTRAINT model_runs_conversation_fk FOREIGN KEY (project_id, conversation_id)
    REFERENCES conversations(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT model_runs_prompt_version_positive CHECK (prompt_version > 0),
  CONSTRAINT model_runs_input_hash_sha256 CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT model_runs_token_counts CHECK (
    (input_tokens IS NULL OR input_tokens >= 0)
    AND (cached_tokens IS NULL OR cached_tokens >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
    AND (latency_ms IS NULL OR latency_ms >= 0)
    AND (cached_tokens IS NULL OR input_tokens IS NULL OR cached_tokens <= input_tokens)
  ),
  CONSTRAINT model_runs_state_shape CHECK (
    (status = 'running' AND completed_at IS NULL AND error_code IS NULL
      AND input_tokens IS NULL AND cached_tokens IS NULL
      AND output_tokens IS NULL AND latency_ms IS NULL)
    OR
    (status = 'completed' AND provider <> 'pending'
      AND completed_at IS NOT NULL AND error_code IS NULL
      AND input_tokens IS NOT NULL AND cached_tokens IS NOT NULL
      AND output_tokens IS NOT NULL AND latency_ms IS NOT NULL)
    OR
    (status IN ('failed', 'interrupted') AND completed_at IS NOT NULL
      AND error_code IS NOT NULL AND latency_ms IS NOT NULL)
  )
);

CREATE TABLE agent_runs (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  agent_name agent_name NOT NULL,
  status agent_run_status NOT NULL,
  version integer NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT agent_runs_pk PRIMARY KEY (project_id, id),
  CONSTRAINT agent_runs_state_object CHECK (jsonb_typeof(state) = 'object'),
  CONSTRAINT agent_runs_version_nonnegative CHECK (version >= 0)
);

CREATE TABLE context_deltas (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  branch_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  base_commit_id uuid NOT NULL,
  through_message_sequence integer NOT NULL,
  schema_version integer NOT NULL,
  extractor_run_id uuid,
  revision_of uuid,
  content_hash char(64) NOT NULL,
  proposed_by jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT context_deltas_pk PRIMARY KEY (project_id, id),
  CONSTRAINT context_deltas_project_conversation_id_uq UNIQUE (project_id, conversation_id, id),
  CONSTRAINT context_deltas_request_scope_uq UNIQUE (project_id, id, branch_id, base_commit_id),
  CONSTRAINT context_deltas_branch_fk FOREIGN KEY (
    project_id, branch_id, conversation_id, base_commit_id
  ) REFERENCES branches(project_id, id, conversation_id, base_commit_id) ON DELETE RESTRICT,
  CONSTRAINT context_deltas_conversation_fk FOREIGN KEY (project_id, conversation_id)
    REFERENCES conversations(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_deltas_base_commit_fk FOREIGN KEY (project_id, base_commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_deltas_extractor_run_fk FOREIGN KEY (project_id, extractor_run_id)
    REFERENCES model_runs(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_deltas_revision_fk FOREIGN KEY (project_id, revision_of)
    REFERENCES context_deltas(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_deltas_sequence_nonnegative CHECK (through_message_sequence >= 0),
  CONSTRAINT context_deltas_schema_version_one CHECK (schema_version = 1),
  CONSTRAINT context_deltas_content_hash_sha256 CHECK (content_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE context_delta_changes (
  project_id uuid NOT NULL,
  delta_id uuid NOT NULL,
  id uuid NOT NULL,
  ordinal integer NOT NULL,
  operation context_operation NOT NULL,
  payload jsonb NOT NULL,
  CONSTRAINT context_delta_changes_pk PRIMARY KEY (project_id, delta_id, id),
  CONSTRAINT context_delta_changes_ordinal_uq UNIQUE (project_id, delta_id, ordinal),
  CONSTRAINT context_delta_changes_delta_fk FOREIGN KEY (project_id, delta_id)
    REFERENCES context_deltas(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_delta_changes_ordinal_nonnegative CHECK (ordinal >= 0)
);

CREATE TABLE context_item_versions (
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  logical_item_id uuid NOT NULL,
  commit_id uuid NOT NULL,
  previous_version_id uuid,
  kind context_item_kind NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  scope jsonb NOT NULL,
  authority context_item_authority NOT NULL,
  confidence double precision NOT NULL,
  lifecycle context_item_lifecycle NOT NULL,
  scope_hash char(64) NOT NULL,
  supersedes_version_id uuid,
  created_at timestamptz NOT NULL,
  CONSTRAINT context_item_versions_pk PRIMARY KEY (project_id, id),
  CONSTRAINT context_item_versions_project_commit_id_uq UNIQUE (project_id, commit_id, id),
  CONSTRAINT context_item_versions_lineage_id_uq UNIQUE (project_id, logical_item_id, id),
  CONSTRAINT context_item_versions_commit_lineage_id_uq UNIQUE (
    project_id, commit_id, logical_item_id, id
  ),
  CONSTRAINT context_item_versions_commit_lineage_uq UNIQUE (
    project_id, commit_id, logical_item_id
  ),
  CONSTRAINT context_item_versions_commit_fk FOREIGN KEY (project_id, commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_item_versions_previous_fk FOREIGN KEY (
    project_id, logical_item_id, previous_version_id
  ) REFERENCES context_item_versions(project_id, logical_item_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_item_versions_supersedes_fk FOREIGN KEY (
    project_id, logical_item_id, supersedes_version_id
  ) REFERENCES context_item_versions(project_id, logical_item_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_item_versions_key_normalized CHECK (key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  CONSTRAINT context_item_versions_confidence_range CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT context_item_versions_scope_hash_sha256 CHECK (scope_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX context_item_versions_commit_authoritative_slot_uq
  ON context_item_versions(project_id, commit_id, kind, key, scope_hash)
  WHERE authority = 'authoritative' AND lifecycle = 'active';

CREATE TABLE context_item_provenance (
  project_id uuid NOT NULL,
  context_item_version_id uuid NOT NULL,
  ordinal integer NOT NULL,
  conversation_id uuid NOT NULL,
  actor jsonb NOT NULL,
  model_run_id uuid,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT context_item_provenance_pk PRIMARY KEY (project_id, context_item_version_id, ordinal),
  CONSTRAINT context_item_provenance_version_fk FOREIGN KEY (project_id, context_item_version_id)
    REFERENCES context_item_versions(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_item_provenance_conversation_fk FOREIGN KEY (project_id, conversation_id)
    REFERENCES conversations(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_item_provenance_model_run_fk FOREIGN KEY (project_id, model_run_id)
    REFERENCES model_runs(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_item_provenance_ordinal_nonnegative CHECK (ordinal >= 0)
);

CREATE TABLE context_item_provenance_messages (
  project_id uuid NOT NULL,
  context_item_version_id uuid NOT NULL,
  provenance_ordinal integer NOT NULL,
  message_ordinal integer NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  CONSTRAINT context_item_provenance_messages_pk PRIMARY KEY (
    project_id, context_item_version_id, provenance_ordinal, message_ordinal
  ),
  CONSTRAINT context_item_provenance_message_uq UNIQUE (
    project_id, context_item_version_id, provenance_ordinal, message_id
  ),
  CONSTRAINT context_item_provenance_messages_source_fk FOREIGN KEY (
    project_id, context_item_version_id, provenance_ordinal
  ) REFERENCES context_item_provenance(project_id, context_item_version_id, ordinal) ON DELETE RESTRICT,
  CONSTRAINT context_item_provenance_messages_message_fk FOREIGN KEY (
    project_id, conversation_id, message_id
  ) REFERENCES messages(project_id, conversation_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_item_provenance_messages_ordinal_nonnegative CHECK (message_ordinal >= 0)
);

CREATE TABLE context_commit_sources (
  project_id uuid NOT NULL,
  commit_id uuid NOT NULL,
  ordinal integer NOT NULL,
  delta_id uuid NOT NULL,
  CONSTRAINT context_commit_sources_pk PRIMARY KEY (project_id, commit_id, ordinal),
  CONSTRAINT context_commit_sources_delta_uq UNIQUE (project_id, commit_id, delta_id),
  CONSTRAINT context_commit_sources_commit_fk FOREIGN KEY (project_id, commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_commit_sources_delta_fk FOREIGN KEY (project_id, delta_id)
    REFERENCES context_deltas(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_commit_sources_ordinal_nonnegative CHECK (ordinal >= 0)
);

CREATE TABLE context_commit_changes (
  project_id uuid NOT NULL,
  commit_id uuid NOT NULL,
  id uuid NOT NULL,
  ordinal integer NOT NULL,
  operation context_operation NOT NULL,
  logical_item_id uuid NOT NULL,
  before_version_id uuid,
  after_version_id uuid NOT NULL,
  source_delta_id uuid NOT NULL,
  source_delta_change_id uuid NOT NULL,
  CONSTRAINT context_commit_changes_pk PRIMARY KEY (project_id, commit_id, id),
  CONSTRAINT context_commit_changes_ordinal_uq UNIQUE (project_id, commit_id, ordinal),
  CONSTRAINT context_commit_changes_commit_fk FOREIGN KEY (project_id, commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_commit_changes_after_version_fk FOREIGN KEY (
    project_id, commit_id, logical_item_id, after_version_id
  ) REFERENCES context_item_versions(project_id, commit_id, logical_item_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_commit_changes_before_version_fk FOREIGN KEY (
    project_id, logical_item_id, before_version_id
  ) REFERENCES context_item_versions(project_id, logical_item_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_commit_changes_delta_change_fk FOREIGN KEY (
    project_id, source_delta_id, source_delta_change_id
  ) REFERENCES context_delta_changes(project_id, delta_id, id) ON DELETE RESTRICT,
  CONSTRAINT context_commit_changes_ordinal_nonnegative CHECK (ordinal >= 0),
  CONSTRAINT context_commit_changes_before_shape CHECK (
    (operation = 'add' AND before_version_id IS NULL)
    OR (operation <> 'add' AND before_version_id IS NOT NULL)
  )
);

CREATE TABLE current_context_items (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  logical_item_id uuid NOT NULL,
  version_id uuid NOT NULL,
  CONSTRAINT current_context_items_pk PRIMARY KEY (project_id, logical_item_id),
  CONSTRAINT current_context_items_version_uq UNIQUE (project_id, version_id),
  CONSTRAINT current_context_items_version_fk FOREIGN KEY (project_id, logical_item_id, version_id)
    REFERENCES context_item_versions(project_id, logical_item_id, id) ON DELETE RESTRICT
);

CREATE TABLE merge_requests (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  branch_id uuid NOT NULL,
  delta_id uuid NOT NULL,
  base_commit_id uuid NOT NULL,
  evaluated_head_commit_id uuid NOT NULL,
  resulting_commit_id uuid,
  status merge_request_status NOT NULL,
  created_by jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT merge_requests_pk PRIMARY KEY (project_id, id),
  CONSTRAINT merge_requests_project_id_delta_uq UNIQUE (project_id, id, delta_id),
  CONSTRAINT merge_requests_branch_fk FOREIGN KEY (project_id, branch_id)
    REFERENCES branches(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT merge_requests_delta_fk FOREIGN KEY (project_id, delta_id)
    REFERENCES context_deltas(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT merge_requests_delta_scope_fk FOREIGN KEY (
    project_id, delta_id, branch_id, base_commit_id
  ) REFERENCES context_deltas(project_id, id, branch_id, base_commit_id) ON DELETE RESTRICT,
  CONSTRAINT merge_requests_base_commit_fk FOREIGN KEY (project_id, base_commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT merge_requests_head_commit_fk FOREIGN KEY (project_id, evaluated_head_commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT merge_requests_result_commit_fk FOREIGN KEY (project_id, resulting_commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT merge_requests_result_shape CHECK (
    (status = 'committed') = (resulting_commit_id IS NOT NULL)
  )
);

CREATE TABLE merge_finalizations (
  project_id uuid NOT NULL,
  merge_request_id uuid NOT NULL,
  operation_key text NOT NULL,
  outcome merge_finalization_outcome NOT NULL,
  resulting_commit_id uuid,
  finalized_at timestamptz NOT NULL,
  CONSTRAINT merge_finalizations_pk PRIMARY KEY (project_id, merge_request_id),
  CONSTRAINT merge_finalizations_operation_key_uq UNIQUE (project_id, operation_key),
  CONSTRAINT merge_finalizations_request_fk FOREIGN KEY (project_id, merge_request_id)
    REFERENCES merge_requests(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT merge_finalizations_result_commit_fk FOREIGN KEY (project_id, resulting_commit_id)
    REFERENCES context_commits(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT merge_finalizations_result_shape CHECK (
    (outcome = 'committed' AND resulting_commit_id IS NOT NULL)
    OR (outcome = 'no_changes' AND resulting_commit_id IS NULL)
  ),
  CONSTRAINT merge_finalizations_operation_key_not_blank CHECK (length(btrim(operation_key)) > 0),
  CONSTRAINT merge_finalizations_operation_key_length CHECK (length(operation_key) <= 200)
);

CREATE TABLE merge_conflicts (
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  merge_request_id uuid NOT NULL,
  delta_id uuid NOT NULL,
  delta_change_id uuid NOT NULL,
  classification conflict_classification NOT NULL,
  base_version jsonb,
  current_version jsonb,
  proposed jsonb,
  reason text NOT NULL,
  requires_human_review boolean NOT NULL,
  resolution jsonb,
  created_at timestamptz NOT NULL,
  CONSTRAINT merge_conflicts_pk PRIMARY KEY (project_id, id),
  CONSTRAINT merge_conflicts_request_fk FOREIGN KEY (project_id, merge_request_id, delta_id)
    REFERENCES merge_requests(project_id, id, delta_id) ON DELETE RESTRICT,
  CONSTRAINT merge_conflicts_delta_change_fk FOREIGN KEY (project_id, delta_id, delta_change_id)
    REFERENCES context_delta_changes(project_id, delta_id, id) ON DELETE RESTRICT,
  CONSTRAINT merge_conflicts_reason_not_blank CHECK (length(btrim(reason)) > 0),
  CONSTRAINT merge_conflicts_duplicate_review CHECK (
    classification <> 'duplicate' OR requires_human_review = false
  ),
  CONSTRAINT merge_conflicts_c3_current CHECK (
    classification <> 'C3' OR current_version IS NOT NULL
  )
);

CREATE TABLE audit_events (
  project_id uuid NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  actor jsonb NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  metadata jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT audit_events_pk PRIMARY KEY (project_id, id),
  CONSTRAINT audit_events_action_not_blank CHECK (length(btrim(action)) > 0),
  CONSTRAINT audit_events_target_type_not_blank CHECK (length(btrim(target_type)) > 0),
  CONSTRAINT audit_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX audit_events_project_time_idx ON audit_events(project_id, occurred_at);

CREATE FUNCTION cce_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER context_commits_immutable
  BEFORE UPDATE OR DELETE ON context_commits FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
CREATE TRIGGER context_commit_sources_immutable
  BEFORE UPDATE OR DELETE ON context_commit_sources FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
CREATE TRIGGER context_commit_changes_immutable
  BEFORE UPDATE OR DELETE ON context_commit_changes FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
CREATE TRIGGER context_item_versions_immutable
  BEFORE UPDATE OR DELETE ON context_item_versions FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
CREATE TRIGGER context_item_provenance_immutable
  BEFORE UPDATE OR DELETE ON context_item_provenance FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
CREATE TRIGGER context_item_provenance_messages_immutable
  BEFORE UPDATE OR DELETE ON context_item_provenance_messages FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
CREATE TRIGGER context_deltas_immutable
  BEFORE UPDATE OR DELETE ON context_deltas FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
CREATE TRIGGER context_delta_changes_immutable
  BEFORE UPDATE OR DELETE ON context_delta_changes FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
CREATE TRIGGER merge_finalizations_immutable
  BEFORE UPDATE OR DELETE ON merge_finalizations FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION cce_reject_mutation();

CREATE FUNCTION cce_guard_model_run_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'model runs are append-only' USING ERRCODE = '55000';
  END IF;

  IF OLD.status <> 'running' THEN
    RAISE EXCEPTION 'terminal model runs are immutable' USING ERRCODE = '55000';
  END IF;

  IF ROW(NEW.project_id, NEW.id, NEW.conversation_id, NEW.purpose, NEW.prompt_id,
         NEW.prompt_version, NEW.input_hash, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.project_id, OLD.id, OLD.conversation_id, OLD.purpose, OLD.prompt_id,
         OLD.prompt_version, OLD.input_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'model run identity and request metadata are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'running' THEN
    RAISE EXCEPTION 'model run updates must be terminal transitions' USING ERRCODE = '55000';
  END IF;

  IF (NEW.provider IS DISTINCT FROM OLD.provider OR NEW.model IS DISTINCT FROM OLD.model)
     AND OLD.provider <> 'pending' THEN
    RAISE EXCEPTION 'resolved model identity is immutable' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER model_runs_state_guard
  BEFORE UPDATE OR DELETE ON model_runs FOR EACH ROW EXECUTE FUNCTION cce_guard_model_run_mutation();

CREATE FUNCTION cce_guard_agent_run_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agent runs are append-only' USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'terminal agent runs are immutable' USING ERRCODE = '55000';
  END IF;

  IF ROW(NEW.project_id, NEW.id, NEW.agent_name, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.project_id, OLD.id, OLD.agent_name, OLD.created_at) THEN
    RAISE EXCEPTION 'agent run identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'agent run version must advance by one' USING ERRCODE = '55000';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'agent run updated_at cannot move backward' USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'cancelled'))
    OR (OLD.status = 'running' AND NEW.status IN (
      'running', 'awaiting_approval', 'completed', 'failed', 'cancelled'
    ))
    OR (OLD.status = 'awaiting_approval' AND NEW.status IN ('completed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid agent run status transition' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runs_state_guard
  BEFORE UPDATE OR DELETE ON agent_runs FOR EACH ROW EXECUTE FUNCTION cce_guard_agent_run_mutation();

CREATE FUNCTION cce_validate_message_reply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reply_to_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM messages AS replied_to
    WHERE replied_to.project_id = NEW.project_id
      AND replied_to.conversation_id = NEW.conversation_id
      AND replied_to.id = NEW.reply_to_message_id
      AND replied_to.role = 'user'
  ) THEN
    RAISE EXCEPTION 'assistant replies must reference an existing user message'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_reply_target_guard
  BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION cce_validate_message_reply();

CREATE FUNCTION cce_guard_message_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'messages are append-only' USING ERRCODE = '55000';
  END IF;

  IF OLD.delivery_state NOT IN ('pending', 'streaming') THEN
    RAISE EXCEPTION 'terminal messages are immutable' USING ERRCODE = '55000';
  END IF;

  IF ROW(NEW.project_id, NEW.id, NEW.conversation_id, NEW.sequence, NEW.client_message_id,
         NEW.reply_to_message_id,
         NEW.role, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.project_id, OLD.id, OLD.conversation_id, OLD.sequence, OLD.client_message_id,
         OLD.reply_to_message_id,
         OLD.role, OLD.created_at) THEN
    RAISE EXCEPTION 'message identity and provenance are immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.author IS DISTINCT FROM OLD.author AND NOT (
    OLD.role = 'assistant'
    AND (OLD.author ->> 'type') IS NOT DISTINCT FROM 'model'
    AND (OLD.author ->> 'provider') IS NOT DISTINCT FROM 'pending'
    AND (NEW.author ->> 'type') IS NOT DISTINCT FROM 'model'
    AND NEW.author ->> 'provider' IS NOT NULL
    AND NEW.author ->> 'provider' <> 'pending'
    AND NEW.author ->> 'model' IS NOT NULL
    AND NEW.author ->> 'runId' IS NOT NULL
    AND (NEW.author ->> 'runId') IS NOT DISTINCT FROM (OLD.author ->> 'runId')
  ) THEN
    RAISE EXCEPTION 'message author may only resolve pending model identity'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.delivery_state = 'pending' AND NEW.delivery_state IN ('pending', 'streaming', 'completed', 'failed'))
    OR (OLD.delivery_state = 'streaming' AND NEW.delivery_state IN ('streaming', 'completed', 'interrupted', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid message delivery transition' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_append_only
  BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION cce_guard_message_mutation();
