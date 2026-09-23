-- Corridor fulfillment Phase 1b: corridors (docs/architecture/corridor-fulfillment.md A14-A16).
-- Postgres-authoritative like 090: written only by FulfillmentService transactions, no foreign
-- keys into snapshot-managed tables. Geometry is a GeoJSON LineString ([lng, lat]) in jsonb; no
-- PostGIS. `distance_meters` is always computed by the server.

create table if not exists fulfillment_corridors (
  id uuid primary key,
  business_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  origin_label text not null check (char_length(origin_label) between 1 and 120),
  destination_label text not null check (char_length(destination_label) between 1 and 120),
  route_geometry jsonb not null check (
    jsonb_typeof(route_geometry) = 'object'
    and route_geometry ->> 'type' = 'LineString'
    and jsonb_typeof(route_geometry -> 'coordinates') = 'array'
    and jsonb_array_length(route_geometry -> 'coordinates') >= 2
  ),
  distance_meters numeric(12, 3) not null check (distance_meters > 0),
  geometry_version integer not null default 1 check (geometry_version > 0),
  -- A15 tie-break: lower wins. 100 is the schema default, not a constant in domain code.
  priority integer not null default 100 check (priority between 0 and 1000000),
  -- Optional policy lineage (fulfillment_dispatch_policies.policy_id); its active version applies.
  policy_override_id uuid,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint fulfillment_corridors_business_id_unique unique (business_id, id)
);

create index if not exists fulfillment_corridors_business_active_idx
  on fulfillment_corridors (business_id, active, priority, id);

-- Every geometry a corridor has ever had, so historical resolutions and manifests that name
-- (corridor_id, geometry_version) remain interpretable after the route is edited (A16).
create table if not exists fulfillment_corridor_geometry_versions (
  business_id uuid not null,
  corridor_id uuid not null,
  version integer not null check (version > 0),
  route_geometry jsonb not null,
  distance_meters numeric(12, 3) not null check (distance_meters > 0),
  created_by text not null,
  created_at timestamptz not null,
  primary key (corridor_id, version),
  constraint fulfillment_corridor_geometry_versions_corridor_fk
    foreign key (business_id, corridor_id)
    references fulfillment_corridors (business_id, id)
    on delete cascade
);
