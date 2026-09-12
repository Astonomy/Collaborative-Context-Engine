ALTER TABLE conversation_imports
  DROP CONSTRAINT conversation_imports_source_format,
  DROP CONSTRAINT conversation_imports_source_shape;

ALTER TABLE conversation_imports
  ADD CONSTRAINT conversation_imports_source_format
    CHECK (source_format IN ('json', 'mcp')) NOT VALID,
  ADD CONSTRAINT conversation_imports_source_shape
    CHECK (
      (source = 'chatgpt' AND source_format = 'json' AND policy = 'current_path')
      OR
      (source IN ('chatgpt-plugin', 'codex-plugin') AND source_format = 'mcp' AND policy = 'provided_messages')
    ) NOT VALID;
