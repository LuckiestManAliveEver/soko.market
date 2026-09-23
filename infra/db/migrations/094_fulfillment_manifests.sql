-- Corridor fulfillment Phase 1c: delivery manifests and stops (A17, A21, A12).
--
-- A manifest freezes one physical trip: its corridor geometry version, policy version and vehicle
-- capacity are snapshotted, and each stop snapshots the order weight and the delivery point used.
-- Later corridor, shop-location or catalogue edits never change a manifest.

create table if not exists fulfillment_manifests (
  id uuid primary key,
  business_id uuid not null,
  corridor_id uuid not null,
  corridor_geometry_version integer not null check (corridor_geometry_version > 0),
  policy_version_id uuid not null,
  policy_id uuid not null,
  policy_version integer not null check (policy_version > 0),
  vehicle_id uuid not null,
  vehicle_capacity_grams bigint not null check (vehicle_capacity_grams > 0),
  status text not null
    check (status in ('DRAFT', 'OPEN', 'CLOSED', 'DEPARTED', 'COMPLETED', 'CANCELLED')),
  total_weight_grams bigint not null check (total_weight_grams >= 0),
  planned_departure_at timestamptz,
  closed_at timestamptz,
  completed_at timestamptz,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  -- A9 capacity is a hard safety constraint, enforced by the database on every write.
  constraint fulfillment_manifests_within_capacity
    check (total_weight_grams <= vehicle_capacity_grams),
  constraint fulfillment_manifests_business_id_unique unique (business_id, id),
  constraint fulfillment_manifests_corridor_fk
    foreign key (business_id, corridor_id) references fulfillment_corridors (business_id, id),
  constraint fulfillment_manifests_geometry_fk
    foreign key (corridor_id, corridor_geometry_version)
    references fulfillment_corridor_geometry_versions (corridor_id, version),
  constraint fulfillment_manifests_vehicle_fk
    foreign key (business_id, vehicle_id) references fulfillment_vehicles (business_id, id),
  constraint fulfillment_manifests_policy_fk
    foreign key (business_id, policy_version_id)
    references fulfillment_dispatch_policies (business_id, id)
);

create index if not exists fulfillment_manifests_business_status_idx
  on fulfillment_manifests (business_id, status, created_at desc);

create table if not exists fulfillment_manifest_stops (
  id uuid primary key,
  business_id uuid not null,
  manifest_id uuid not null,
  fulfillment_order_id uuid not null,
  invoice_id uuid not null,
  customer_id uuid,
  corridor_resolution_id uuid not null,
  shop_location_id uuid not null,
  sequence integer not null check (sequence > 0),
  distance_along_meters numeric(12, 3) not null check (distance_along_meters >= 0),
  diversion_meters numeric(12, 3) not null check (diversion_meters >= 0),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  order_weight_grams bigint not null check (order_weight_grams >= 0),
  allocation_active boolean not null,
  delivery_status text not null
    check (delivery_status in ('PENDING', 'ARRIVED', 'DELIVERED', 'FAILED', 'SKIPPED')),
  delivery_note text check (delivery_note is null or char_length(delivery_note) <= 240),
  released_at timestamptz,
  release_reason text check (
    release_reason is null
    or release_reason in ('REMOVED_BY_DISPATCHER', 'ORDER_CANCELLED', 'DELIVERY_FAILED', 'DELIVERY_SKIPPED')
  ),
  delivery_recorded_by text,
  delivery_recorded_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint fulfillment_manifest_stops_business_id_unique unique (business_id, id),
  constraint fulfillment_manifest_stops_sequence_unique unique (manifest_id, sequence),
  constraint fulfillment_manifest_stops_manifest_fk
    foreign key (business_id, manifest_id) references fulfillment_manifests (business_id, id),
  constraint fulfillment_manifest_stops_order_fk
    foreign key (business_id, fulfillment_order_id) references fulfillment_orders (business_id, id),
  constraint fulfillment_manifest_stops_location_fk
    foreign key (business_id, shop_location_id)
    references fulfillment_shop_locations (business_id, id),
  -- An inactive stop always says why it was released.
  constraint fulfillment_manifest_stops_release_consistent check (
    (allocation_active and released_at is null and release_reason is null)
    or (not allocation_active and released_at is not null and release_reason is not null)
  )
);

-- A17: one order is in at most one active manifest allocation. This index is the final database
-- defence; corridor and order row locks serialize allocation, but correctness does not depend on
-- application code alone.
create unique index if not exists fulfillment_manifest_stops_one_active_allocation_idx
  on fulfillment_manifest_stops (fulfillment_order_id)
  where allocation_active;
create index if not exists fulfillment_manifest_stops_manifest_idx
  on fulfillment_manifest_stops (business_id, manifest_id, sequence);
