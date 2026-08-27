alter table mcp_access_tokens
  rename column created_by_session_id to session_id;

alter table mcp_access_tokens
  alter column session_id set not null;

alter table mcp_access_tokens
  add constraint mcp_access_tokens_session_id_fkey
  foreign key (session_id) references sessions (id) on delete cascade;
