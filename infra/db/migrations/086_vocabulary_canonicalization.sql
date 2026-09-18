-- Template vocabulary canonicalization authoritative store.
-- Entries are unique per business/surface form for review dedupe. Repeated evidence is preserved
-- in cp2_vocabulary_occurrences so uniqueness never destroys provenance.

create table if not exists cp2_vocabulary_entries (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_vocabulary_entries_scope_check check (record ->> 'businessId' = business_id),
  constraint cp2_vocabulary_entries_status_check check (
    record ->> 'status' in ('CANDIDATE','APPROVED','REJECTED')
  )
);
create unique index if not exists cp2_vocabulary_entries_surface_idx
  on cp2_vocabulary_entries (business_id, (record ->> 'surfaceForm'));
create index if not exists cp2_vocabulary_entries_review_idx
  on cp2_vocabulary_entries (business_id, (record ->> 'status'), (record ->> 'createdAt'));

create table if not exists cp2_vocabulary_occurrences (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_vocabulary_entries(entity_id) on delete cascade,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_vocabulary_occurrences_parent_check check (
    record ->> 'vocabularyEntryId' = parent_id
  )
);
create index if not exists cp2_vocabulary_occurrences_entry_idx
  on cp2_vocabulary_occurrences (parent_id, (record ->> 'createdAt'));
