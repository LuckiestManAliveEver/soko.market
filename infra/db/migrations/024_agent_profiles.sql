create table if not exists cp2_agent_profiles (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_agent_profiles_business_idx
  on cp2_agent_profiles (business_id)
  where business_id is not null;
