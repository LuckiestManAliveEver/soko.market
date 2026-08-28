create table if not exists cp2_installed_oss_agent_manifests (
  account_id text not null references cp2_accounts(entity_id) on delete cascade,
  user_id text not null,
  agent_definition_id text not null,
  manifest jsonb not null,
  installed_at timestamp with time zone not null,
  updated_at timestamp with time zone not null default now(),
  primary key (account_id, user_id, agent_definition_id)
);

create table if not exists cp2_model_artifacts (
  artifact_id text primary key,
  account_id text not null references cp2_accounts(entity_id) on delete cascade,
  user_id text not null,
  model_id text not null,
  metadata jsonb not null,
  file_size_bytes bigint not null check (file_size_bytes >= 4),
  chunk_size_bytes integer not null check (chunk_size_bytes > 0),
  chunk_count integer not null check (chunk_count > 0),
  status text not null check (status in ('UPLOADING', 'READY', 'FAILED')),
  created_at timestamp with time zone not null,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_model_artifacts_owner_idx
  on cp2_model_artifacts (account_id, user_id, status, completed_at desc);

create table if not exists cp2_model_artifact_chunks (
  artifact_id text not null references cp2_model_artifacts(artifact_id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content bytea not null,
  updated_at timestamp with time zone not null default now(),
  primary key (artifact_id, chunk_index)
);

comment on table cp2_model_artifact_chunks is
  'Private account-scoped GGUF chunks stored in the existing Neon/Postgres database.';
