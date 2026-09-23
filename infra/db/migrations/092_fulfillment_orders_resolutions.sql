-- Corridor fulfillment Phase 1b: fulfillment orders and corridor-resolution provenance (A16).
--
-- `fulfillment_orders` is the stable, lockable fulfillment row for one confirmed canonical order
-- (a Cp2Store invoice). It is created on first resolution here; Phase 1c adds intake, weight and
-- pool state. `invoice_id`/`customer_id` reference snapshot-managed records by value only (no FK).
create table if not exists fulfillment_orders (
  id uuid primary key,
  business_id uuid not null,
  invoice_id uuid not null,
  customer_id uuid,
  confirmed_at timestamptz not null,
  created_at timestamptz not null,
  constraint fulfillment_orders_business_id_unique unique (business_id, id),
  constraint fulfillment_orders_business_invoice_unique unique (business_id, invoice_id)
);

-- Append-only provenance: a re-resolution inserts a new row and only stamps `superseded_at` on
-- the previous one; no provenance field is ever rewritten. At most one current row per order.
create table if not exists fulfillment_corridor_resolutions (
  id uuid primary key,
  business_id uuid not null,
  fulfillment_order_id uuid not null,
  corridor_id uuid not null,
  corridor_geometry_version integer not null check (corridor_geometry_version > 0),
  shop_location_id uuid not null,
  diversion_meters numeric(12, 3) not null check (diversion_meters >= 0),
  distance_along_meters numeric(12, 3) not null check (distance_along_meters >= 0),
  segment_index integer not null check (segment_index >= 0),
  max_diversion_meters integer not null check (max_diversion_meters > 0),
  resolution_method text not null check (resolution_method in ('AUTO', 'MANUAL')),
  resolved_by text not null,
  resolved_at timestamptz not null,
  superseded_at timestamptz,
  constraint fulfillment_corridor_resolutions_order_fk
    foreign key (business_id, fulfillment_order_id)
    references fulfillment_orders (business_id, id),
  constraint fulfillment_corridor_resolutions_corridor_fk
    foreign key (business_id, corridor_id)
    references fulfillment_corridors (business_id, id),
  constraint fulfillment_corridor_resolutions_geometry_fk
    foreign key (corridor_id, corridor_geometry_version)
    references fulfillment_corridor_geometry_versions (corridor_id, version),
  constraint fulfillment_corridor_resolutions_location_fk
    foreign key (business_id, shop_location_id)
    references fulfillment_shop_locations (business_id, id),
  constraint fulfillment_corridor_resolutions_diversion_within_tolerance
    check (diversion_meters <= max_diversion_meters)
);

create unique index if not exists fulfillment_corridor_resolutions_one_current_idx
  on fulfillment_corridor_resolutions (business_id, fulfillment_order_id)
  where superseded_at is null;
create index if not exists fulfillment_corridor_resolutions_corridor_idx
  on fulfillment_corridor_resolutions (business_id, corridor_id)
  where superseded_at is null;
create index if not exists fulfillment_corridor_resolutions_history_idx
  on fulfillment_corridor_resolutions (business_id, fulfillment_order_id, resolved_at desc);
