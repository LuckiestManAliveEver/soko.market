-- Reverses 105_network_connections.sql. Phonebook contacts and their Soko links live in
-- cp2_network_nodes / cp2_soko_identity_links and are untouched; only connection records are dropped.
drop table if exists cp2_network_connections;
