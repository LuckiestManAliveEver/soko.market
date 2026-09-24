drop table if exists fulfillment_outbox_events;
drop table if exists fulfillment_vehicle_reservations;
drop table if exists fulfillment_dispatch_approvals;
drop table if exists fulfillment_dispatch_evaluations;

alter table fulfillment_manifests
  drop column if exists departed_at;
