-- Structured experience memory (docs/architecture/muse-adoption-audit.md,
-- docs/architecture/experience-memory.md). Fills the "recall" AgentContextSourceType slot and the
-- recall.* RuntimeTelemetryState values that already existed (039_agent_business_runtime.sql,
-- packages/shared-types) but had no backing store - purely additive, next to the existing
-- cp2_agent_context_sources / cp2_agent_owner_corrections / cp2_agent_evaluation_events tables in
-- the same family. Never used to resume execution (that remains cp2_runtime_handoffs); this table
-- holds reusable, validated lessons distilled from completed turns.
--
-- Same generic-entity envelope shape as every other CP2 domain table
-- (011_cp2_normalized_store.sql): entity_id is an application-generated UUID, business_id scopes
-- tenant isolation, record is the JSONB RuntimeExperience payload.

create table if not exists cp2_runtime_experiences (
  entity_id text primary key check (
    entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  validation_state text generated always as (record ->> 'validationState') stored,
  lesson_key text generated always as (record ->> 'lessonKey') stored,
  constraint cp2_runtime_experiences_record_check check (
    char_length(record ->> 'id') between 1 and 200
    and char_length(record ->> 'lessonKey') between 1 and 200
    and char_length(record ->> 'lesson') between 1 and 2000
    and (record ->> 'corroborationCount')::integer >= 1
  ),
  constraint cp2_runtime_experiences_validation_state_check check (
    record ->> 'validationState' in ('candidate', 'validated', 'deprecated')
  ),
  constraint cp2_runtime_experiences_outcome_check check (
    record ->> 'outcome' in ('successful', 'adjusted', 'rejected', 'failed', 'unknown')
  )
);

-- Corroboration lookup: "has this exact lesson already been recorded for this business" - the hot
-- path every extraction attempt runs before deciding whether to insert a new candidate or bump an
-- existing row's corroborationCount.
create index if not exists cp2_runtime_experiences_business_lesson_idx
  on cp2_runtime_experiences (business_id, lesson_key);

-- Recall retrieval: "give me this business's validated (recall-eligible) experiences."
create index if not exists cp2_runtime_experiences_business_state_idx
  on cp2_runtime_experiences (business_id, validation_state);
