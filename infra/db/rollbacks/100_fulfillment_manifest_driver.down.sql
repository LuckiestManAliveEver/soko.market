drop index if exists fulfillment_manifests_driver_idx;

alter table fulfillment_manifests
  drop column if exists driver_user_id;
