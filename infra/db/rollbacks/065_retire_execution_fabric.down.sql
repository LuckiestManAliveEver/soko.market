do $$
begin
  raise exception 'Migration 065 is irreversible: retired runtime tables are not recreated.';
end;
$$;
