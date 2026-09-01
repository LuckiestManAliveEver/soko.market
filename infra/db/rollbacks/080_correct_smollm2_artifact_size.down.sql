update cp2_model_artifacts
set size_bytes = 230000000, updated_at = now()
where id = 'builtin:smollm2-360m:q4_0:gguf' and sha256 = 'c3608933eb6e5763b87f769bda40c204dc158333668c7af214644fe39da58627';
