-- Reverses 071_platform_catalog.sql. The application falls back to the hardcoded
-- aiModelRegistry/defaultAgentDefinition bootstrap content whenever these tables are empty (see
-- Cp2Store.seedCatalogDefaultsIfEmpty), so dropping them is safe for a coordinated downgrade to the
-- pre-071 application and does not strand a running deployment mid-rollback.

drop table if exists cp2_platform_operators;
drop table if exists cp2_agent_catalog;
drop table if exists cp2_model_catalog;
