-- Portable Model Templates and their recursive expertise-improvement lifecycle.
-- These tables extend the existing CP2 control plane. They do not store model weights.

create table if not exists cp2_model_templates (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_model_templates_scope_check check (record ->> 'businessId' = business_id)
);
create unique index if not exists cp2_model_templates_business_slug_idx
  on cp2_model_templates (business_id, (record ->> 'slug'));

create table if not exists cp2_model_template_versions (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_model_templates(entity_id) on delete cascade,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_model_template_versions_parent_check check (record ->> 'templateId' = parent_id),
  constraint cp2_model_template_versions_state_check check (
    record ->> 'state' in ('DRAFT','CANDIDATE','EVALUATING','PASSED','FAILED','PROMOTED','RETIRED')
  )
);
create unique index if not exists cp2_model_template_versions_semver_idx
  on cp2_model_template_versions (parent_id, (record ->> 'version'));

create table if not exists cp2_expertise_artifacts (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_model_template_versions(entity_id) on delete cascade,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_expertise_artifacts_parent_check check (record ->> 'templateVersionId' = parent_id),
  constraint cp2_expertise_artifacts_checksum_check check (
    record ->> 'inlineSha256' ~ '^sha256:[0-9a-f]{64}$'
  )
);

create table if not exists cp2_template_evaluation_suites (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_model_templates(entity_id) on delete cascade,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_evaluation_suites_parent_check check (record ->> 'templateId' = parent_id)
);
create unique index if not exists cp2_template_evaluation_suites_version_idx
  on cp2_template_evaluation_suites (parent_id, ((record ->> 'version')::integer));

create table if not exists cp2_template_evaluation_cases (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_template_evaluation_suites(entity_id) on delete cascade,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_evaluation_cases_parent_check check (record ->> 'suiteId' = parent_id)
);

create table if not exists cp2_template_evaluation_runs (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_template_evaluation_suites(entity_id) on delete restrict,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_evaluation_runs_parent_check check (record ->> 'suiteId' = parent_id),
  constraint cp2_template_evaluation_runs_status_check check (
    record ->> 'status' in ('RUNNING','COMPLETED','FAILED')
  )
);
create index if not exists cp2_template_evaluation_runs_candidate_idx
  on cp2_template_evaluation_runs ((record ->> 'candidateVersionId'), (record ->> 'startedAt'));

create table if not exists cp2_template_evaluation_results (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_template_evaluation_runs(entity_id) on delete cascade,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_evaluation_results_parent_check check (record ->> 'evaluationRunId' = parent_id)
);
create unique index if not exists cp2_template_evaluation_results_case_idx
  on cp2_template_evaluation_results (parent_id, (record ->> 'caseId'));

create table if not exists cp2_template_production_observations (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_model_template_versions(entity_id) on delete restrict,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_observations_parent_check check (record ->> 'templateVersionId' = parent_id),
  constraint cp2_template_observations_state_check check (
    record ->> 'state' in ('OBSERVED','CANDIDATE_FAILURE','REVIEWED','CORRECTED','APPROVED')
  )
);
create index if not exists cp2_template_observations_review_idx
  on cp2_template_production_observations (business_id, (record ->> 'state'), (record ->> 'createdAt'));

create table if not exists cp2_template_expert_corrections (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_template_production_observations(entity_id) on delete restrict,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_corrections_parent_check check (record ->> 'observationId' = parent_id),
  constraint cp2_template_corrections_status_check check (
    record ->> 'status' in ('SUBMITTED','APPROVED','REJECTED')
  )
);

create table if not exists cp2_template_dataset_versions (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_model_templates(entity_id) on delete restrict,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_dataset_versions_parent_check check (record ->> 'templateId' = parent_id),
  constraint cp2_template_dataset_versions_frozen_check check (record ->> 'status' = 'FROZEN'),
  constraint cp2_template_dataset_versions_checksum_check check (
    record ->> 'contentSha256' ~ '^sha256:[0-9a-f]{64}$'
  )
);
create unique index if not exists cp2_template_dataset_versions_number_idx
  on cp2_template_dataset_versions (parent_id, ((record ->> 'version')::integer));

create table if not exists cp2_template_dataset_examples (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_template_dataset_versions(entity_id) on delete restrict,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_dataset_examples_parent_check check (record ->> 'datasetVersionId' = parent_id),
  constraint cp2_template_dataset_examples_split_check check (
    record ->> 'split' in ('TRAINING','VALIDATION','REGRESSION')
  )
);

create table if not exists cp2_template_improvement_runs (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_model_template_versions(entity_id) on delete restrict,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_improvement_runs_parent_check check (record ->> 'templateVersionId' = parent_id),
  constraint cp2_template_improvement_runs_status_check check (
    record ->> 'status' in ('RUNNING','COMPLETED','FAILED')
  )
);

create table if not exists cp2_template_promotions (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_model_template_versions(entity_id) on delete restrict,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_promotions_parent_check check (record ->> 'candidateVersionId' = parent_id),
  constraint cp2_template_promotions_decision_check check (
    record ->> 'decision' in ('PROMOTED','REJECTED','ROLLED_BACK')
  )
);

create table if not exists cp2_template_runtime_bindings (
  entity_id text primary key,
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text not null,
  user_id text,
  parent_id text not null references cp2_model_template_versions(entity_id) on delete restrict,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_template_runtime_bindings_parent_check check (record ->> 'templateVersionId' = parent_id),
  constraint cp2_template_runtime_bindings_status_check check (record ->> 'status' in ('ACTIVE','INACTIVE'))
);
create unique index if not exists cp2_template_runtime_bindings_one_active_idx
  on cp2_template_runtime_bindings ((record ->> 'templateId'))
  where record ->> 'status' = 'ACTIVE';

-- Dataset content is immutable. The snapshot writer may issue an identical upsert, which is safe.
create or replace function reject_changed_frozen_template_record()
returns trigger language plpgsql as $$
begin
  if new.record is distinct from old.record then
    raise exception 'frozen model-template records are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists cp2_template_dataset_versions_immutable on cp2_template_dataset_versions;
create trigger cp2_template_dataset_versions_immutable
before update on cp2_template_dataset_versions
for each row execute function reject_changed_frozen_template_record();

drop trigger if exists cp2_template_dataset_examples_immutable on cp2_template_dataset_examples;
create trigger cp2_template_dataset_examples_immutable
before update on cp2_template_dataset_examples
for each row execute function reject_changed_frozen_template_record();
