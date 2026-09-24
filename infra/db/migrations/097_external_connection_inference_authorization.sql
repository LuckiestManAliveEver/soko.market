-- Adds an explicit, off-by-default flag distinguishing "this Hugging Face connection may be used
-- to raise Hub discovery rate limits" (the only thing cp2_external_registry_connections was used
-- for before this migration) from "this connection's token may be used to bill this account's own
-- Hugging Face inference usage instead of the platform's". These are different authorizations with
-- different consequences (one can cost the connected account real money) and must not be conflated
-- by inferring one from the other - see docs/architecture/huggingface-inference.md. Connecting an
-- account (POST /v1/external-connections/huggingface) never sets this true; only the dedicated
-- POST /v1/external-connections/:id/inference-authorization endpoint does, so enabling billing to a
-- user's own account is always a distinct, explicit action.
alter table cp2_external_registry_connections
  add column if not exists inference_authorized boolean not null default false;
