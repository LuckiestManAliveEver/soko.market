create table if not exists cp2_agent_runtime_versions (
  entity_id text primary key check (
    entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists cp2_agent_runtime_versions_business_version_idx
  on cp2_agent_runtime_versions (business_id, ((record ->> 'version')::integer));

create table if not exists cp2_agent_context_sources (
  entity_id text primary key check (
    entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_agent_context_sources_business_type_idx
  on cp2_agent_context_sources (business_id, (record ->> 'type'));

create table if not exists cp2_agent_evaluation_events (
  entity_id text primary key check (
    entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_agent_evaluation_events_business_created_idx
  on cp2_agent_evaluation_events (business_id, (record ->> 'createdAt'));

create table if not exists cp2_agent_owner_corrections (
  entity_id text primary key check (
    entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_agent_owner_corrections_business_status_idx
  on cp2_agent_owner_corrections (business_id, (record ->> 'status'));
