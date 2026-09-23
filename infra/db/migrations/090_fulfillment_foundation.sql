-- Corridor fulfillment Phase 1a foundation (docs/architecture/corridor-fulfillment.md §5, §7).
--
-- These tables are Postgres-authoritative: they are written only inside FulfillmentService
-- request transactions (services/api/src/cp2/domains/fulfillment/), never by the Cp2Store snapshot
-- writer, and are deliberately absent from postgres-store.ts `normalizedCollections`. They hold no
-- foreign keys into snapshot-managed tables (businesses, customers, products, invoices): the
-- snapshot writer hard-deletes rows it no longer holds in memory, and a RESTRICT reference would
-- fail its all-tenant transaction. Tenant integrity is `business_id` on every row plus composite
-- (business_id, id) keys for references between fulfillment tables.

create table if not exists fulfillment_vehicles (
  id uuid primary key,
  business_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  registration text check (registration is null or char_length(registration) between 1 and 32),
  capacity_grams bigint not null check (capacity_grams > 0),
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint fulfillment_vehicles_business_id_unique unique (business_id, id)
);

create index if not exists fulfillment_vehicles_business_idx
  on fulfillment_vehicles (business_id, active, name);
create unique index if not exists fulfillment_vehicles_registration_unique_idx
  on fulfillment_vehicles (business_id, lower(registration))
  where registration is not null;

-- One row per immutable policy VERSION. Rule columns are never updated after insert; a revision
-- inserts version n+1 and flips only `active` on version n, so a manifest referencing
-- (policy_id, version) keeps its original interpretation (A9).
create table if not exists fulfillment_dispatch_policies (
  id uuid primary key,
  policy_id uuid not null,
  business_id uuid not null,
  version integer not null check (version > 0),
  name text not null check (char_length(name) between 1 and 80),
  target_load_grams bigint not null check (target_load_grams > 0),
  minimum_dispatch_load_grams bigint
    check (minimum_dispatch_load_grams is null or minimum_dispatch_load_grams > 0),
  max_diversion_meters integer not null check (max_diversion_meters between 1 and 1000000),
  cutoff_local_time text not null check (cutoff_local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  max_wait_hours integer not null check (max_wait_hours between 1 and 8760),
  fulfillment_lead_days integer not null check (fulfillment_lead_days between 0 and 60),
  under_threshold_fallback text[] not null default '{}'
    check (
      under_threshold_fallback <@ array[
        'TRY_SMALLER_VEHICLE', 'TRY_COMPATIBLE_CORRIDOR', 'REQUIRE_DISPATCH_APPROVAL'
      ]::text[]
    ),
  overflow_strategy text not null check (overflow_strategy in ('NEXT_MANIFEST')),
  active boolean not null,
  supersedes_id uuid references fulfillment_dispatch_policies (id),
  created_by text not null,
  created_at timestamptz not null,
  constraint fulfillment_dispatch_policies_minimum_within_target
    check (minimum_dispatch_load_grams is null or minimum_dispatch_load_grams <= target_load_grams),
  constraint fulfillment_dispatch_policies_business_id_unique unique (business_id, id),
  constraint fulfillment_dispatch_policies_version_unique unique (policy_id, version),
  constraint fulfillment_dispatch_policies_business_policy_unique unique (business_id, policy_id, version)
);

create unique index if not exists fulfillment_dispatch_policies_one_active_version_idx
  on fulfillment_dispatch_policies (policy_id)
  where active;
create index if not exists fulfillment_dispatch_policies_business_idx
  on fulfillment_dispatch_policies (business_id, policy_id, version desc);

-- Per-business fulfillment pointers. `default_policy_id` names a policy lineage; the effective
-- default is that lineage's active version. A corridor override arrives in Phase 1b.
create table if not exists fulfillment_business_settings (
  business_id uuid primary key,
  default_policy_id uuid,
  updated_by text not null,
  updated_at timestamptz not null
);

-- A shop's delivery points, append-only. At most one current (unsuperseded) row per shop; a new
-- capture supersedes the previous one in the same transaction. Missing row = UNRESOLVED (A6).
create table if not exists fulfillment_shop_locations (
  id uuid primary key,
  business_id uuid not null,
  customer_id uuid not null,
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  accuracy_meters integer check (accuracy_meters is null or accuracy_meters between 0 and 100000),
  captured_at timestamptz not null,
  captured_by text not null,
  superseded_at timestamptz,
  created_at timestamptz not null,
  constraint fulfillment_shop_locations_business_id_unique unique (business_id, id),
  constraint fulfillment_shop_locations_superseded_after_capture
    check (superseded_at is null or superseded_at >= created_at)
);

create unique index if not exists fulfillment_shop_locations_one_current_idx
  on fulfillment_shop_locations (business_id, customer_id)
  where superseded_at is null;
create index if not exists fulfillment_shop_locations_history_idx
  on fulfillment_shop_locations (business_id, customer_id, created_at desc);

-- A23 idempotency. Written in the same transaction as the mutation it guards; the primary key
-- resolves concurrent first-writers (the loser blocks on the index until the winner commits, then
-- reads the stored response). Retention is configuration (FULFILLMENT_IDEMPOTENCY_RETENTION_HOURS).
create table if not exists fulfillment_idempotency_records (
  business_id uuid not null,
  operation text not null check (char_length(operation) between 1 and 80),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_hash text not null check (char_length(request_hash) = 64),
  response_snapshot jsonb,
  created_at timestamptz not null,
  primary key (business_id, operation, idempotency_key)
);

create index if not exists fulfillment_idempotency_records_created_idx
  on fulfillment_idempotency_records (created_at);
