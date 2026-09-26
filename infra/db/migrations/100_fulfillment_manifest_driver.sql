-- Named driver on a delivery manifest (docs/architecture/corridor-fulfillment.md §16): a dispatcher
-- assigns the trip to one member of the business who can record deliveries; a driver-role member
-- sees and works only the manifests assigned to them. Null = not assigned (dispatchers work it).
alter table fulfillment_manifests
  add column if not exists driver_user_id text;

create index if not exists fulfillment_manifests_driver_idx
  on fulfillment_manifests (business_id, driver_user_id)
  where driver_user_id is not null;
