-- MCP credentials outlive browser sessions. Keep the creating session UUID only as optional
-- audit provenance and remove the cascading lifecycle dependency on sessions.
alter table mcp_access_tokens
  drop constraint if exists mcp_access_tokens_session_id_fkey;

alter table mcp_access_tokens
  rename column session_id to created_by_session_id;

alter table mcp_access_tokens
  alter column created_by_session_id drop not null;
