-- Reverses 101_multi_provider_inference.sql. Every object it created is new and nothing else in
-- the schema references these tables, so dropping them restores the exact pre-101 schema.
-- Irreversible for data: connected BYOK credentials and usage telemetry are deleted. Catalog rows
-- that carry an `inference` block keep it (unknown JSON fields are ignored by older builds).
drop table if exists inference_policies;
drop table if exists inference_runs;
drop table if exists inference_provider_credentials;
drop table if exists inference_providers;
