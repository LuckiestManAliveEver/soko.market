-- Corridor fulfillment Phase 2: policy evaluations, approvals, vehicle reservations and outbox.

alter table fulfillment_manifests
  add column if not exists departed_at timestamptz;

create table if not exists fulfillment_dispatch_evaluations (
  id uuid primary key,
  business_id uuid not null,
  corridor_id uuid not null,
  policy_version_id uuid not null,
  business_date date not null,
  outcome text not null check (outcome in ('READY', 'WAIT', 'FALLBACK', 'APPROVAL_REQUIRED')),
  readiness text not null check (readiness in ('ACCUMULATING', 'DISPATCHABLE', 'DISPATCH_READY')),
  max_wait_reached boolean not null,
  recommendation jsonb,
  reason text not null,
  evaluated_by text not null,
  evaluated_at timestamptz not null,
  constraint fulfillment_dispatch_evaluations_day_unique
    unique (business_id, corridor_id, business_date),
  constraint fulfillment_dispatch_evaluations_corridor_fk
    foreign key (business_id, corridor_id) references fulfillment_corridors (business_id, id),
  constraint fulfillment_dispatch_evaluations_policy_fk
    foreign key (business_id, policy_version_id)
    references fulfillment_dispatch_policies (business_id, id)
);

create table if not exists fulfillment_dispatch_approvals (
  id uuid primary key,
  business_id uuid not null,
  corridor_id uuid not null,
  evaluation_id uuid not null unique references fulfillment_dispatch_evaluations (id),
  policy_version_id uuid not null,
  status text not null check (status in ('OPEN', 'APPROVED', 'DEFERRED', 'REJECTED')),
  reason text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint fulfillment_dispatch_approvals_decision_consistent check (
    (status = 'OPEN' and decided_by is null and decided_at is null)
    or (status <> 'OPEN' and decided_by is not null and decided_at is not null)
  ),
  constraint fulfillment_dispatch_approvals_corridor_fk
    foreign key (business_id, corridor_id) references fulfillment_corridors (business_id, id),
  constraint fulfillment_dispatch_approvals_policy_fk
    foreign key (business_id, policy_version_id)
    references fulfillment_dispatch_policies (business_id, id)
);

create unique index if not exists fulfillment_dispatch_approvals_one_open_idx
  on fulfillment_dispatch_approvals (business_id, corridor_id)
  where status = 'OPEN';

create table if not exists fulfillment_vehicle_reservations (
  id uuid primary key,
  business_id uuid not null,
  vehicle_id uuid not null,
  manifest_id uuid not null unique,
  service_date date not null,
  active boolean not null default true,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint fulfillment_vehicle_reservations_release_consistent check (
    (active and released_at is null and release_reason is null)
    or (not active and released_at is not null and release_reason is not null)
  ),
  constraint fulfillment_vehicle_reservations_vehicle_fk
    foreign key (business_id, vehicle_id) references fulfillment_vehicles (business_id, id),
  constraint fulfillment_vehicle_reservations_manifest_fk
    foreign key (business_id, manifest_id) references fulfillment_manifests (business_id, id)
);

create unique index if not exists fulfillment_vehicle_reservations_active_day_idx
  on fulfillment_vehicle_reservations (business_id, vehicle_id, service_date)
  where active;

create table if not exists fulfillment_outbox_events (
  id uuid primary key,
  business_id uuid not null,
  event_type text not null,
  event_key text not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  delivered_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  constraint fulfillment_outbox_events_key_unique unique (business_id, event_key)
);

create index if not exists fulfillment_outbox_events_pending_idx
  on fulfillment_outbox_events (occurred_at, id)
  where delivered_at is null;
