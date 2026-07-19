create table if not exists cp2_installed_agent_models (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_installed_agent_models_owner_idx
  on cp2_installed_agent_models (account_id, user_id)
  where account_id is not null and user_id is not null;

create table if not exists cp2_agent_model_assignments (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_agent_model_assignments_business_idx
  on cp2_agent_model_assignments (business_id)
  where business_id is not null;

create index if not exists cp2_agent_model_assignments_owner_idx
  on cp2_agent_model_assignments (account_id, user_id)
  where account_id is not null and user_id is not null;
