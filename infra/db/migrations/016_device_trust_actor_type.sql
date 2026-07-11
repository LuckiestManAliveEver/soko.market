alter table device_trust
  add column if not exists updated_by_type text not null default 'user';

alter table device_trust alter column updated_by drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'device_trust_updated_by_actor_check'
      and conrelid = 'device_trust'::regclass
  ) then
    alter table device_trust
      add constraint device_trust_updated_by_actor_check
      check (
        (updated_by_type = 'user' and updated_by is not null)
        or (updated_by_type in ('system', 'service') and updated_by is null)
      );
  end if;
end $$;
