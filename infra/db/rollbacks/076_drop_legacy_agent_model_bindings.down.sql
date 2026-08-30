do $$
begin
  raise exception 'Migration 076 is irreversible: retired runtime tables are not recreated.';
end;
$$;
