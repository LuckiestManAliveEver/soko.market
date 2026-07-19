-- Reassert the canonical registry in a new migration so deployments that recorded
-- migration 032 without retaining its CHECK definition are repaired on rollout.
update account_sync_changes
set collection = case collection
  when 'sessionContexts' then 'session_context'
  when 'conversationMessages' then 'conversation_messages'
  when 'conversationParticipants' then 'conversation_participants'
  when 'conversationTyping' then 'conversation_typing'
  else collection
end
where collection in (
  'sessionContexts',
  'conversationMessages',
  'conversationParticipants',
  'conversationTyping'
);

do $$
begin
  if exists (
    select 1
    from account_sync_changes
    where collection not in (
      'session_context',
      'shops',
      'conversations',
      'conversation_messages',
      'conversation_participants',
      'conversation_typing'
    )
  ) then
    raise exception 'Unknown account_sync_changes.collection values remain; refusing to repair account_sync_changes_collection_check';
  end if;
end
$$;

alter table account_sync_changes
  drop constraint if exists account_sync_changes_collection_check;

alter table account_sync_changes
  add constraint account_sync_changes_collection_check
  check (
    collection in (
      'session_context',
      'shops',
      'conversations',
      'conversation_messages',
      'conversation_participants',
      'conversation_typing'
    )
  );
