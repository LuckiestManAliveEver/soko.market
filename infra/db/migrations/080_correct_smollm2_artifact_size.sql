-- Migration 079 seeded cp2_runtime_model_artifacts.size_bytes for the platform default SmolLM2
-- artifact as an approximate, rounded value (230000000). Live verification of the Vercel inference
-- runtime (services/ai-runtime/src/artifact-loader.ts, downloadVerifiedArtifact) downloaded the
-- exact upstream file identified by the migration's own sha256 (unchanged, and it matched
-- byte-for-byte) and measured its real size: 229733280 bytes. downloadVerifiedArtifact rejects any
-- download whose byte count does not exactly equal the declared sizeBytes
-- (ARTIFACT_SIZE_MISMATCH, fail-closed by design), so the rounded placeholder would have made
-- every real inference request fail against the correctly-uploaded artifact. This corrects the
-- metadata to match the real object, not the other way around - the object in Neon object storage
-- is not being re-uploaded or re-encoded.
update cp2_runtime_model_artifacts
set size_bytes = 229733280, updated_at = now()
where id = 'builtin:smollm2-360m:q4_0:gguf' and sha256 = 'c3608933eb6e5763b87f769bda40c204dc158333668c7af214644fe39da58627';
