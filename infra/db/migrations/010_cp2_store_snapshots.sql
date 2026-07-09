create table if not exists cp2_store_snapshots (
  id text primary key,
  version integer not null,
  data jsonb not null,
  updated_at timestamp with time zone not null
);
