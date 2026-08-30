do $$
begin
  raise exception 'Migration 075 is irreversible: retired runtime tables are not recreated.';
end;
$$;
