-- The migration runner wraps every migration and its tracking-row insert in one transaction.
-- Normalize only legacy serializer keys that map unambiguously to canonical sync collections.
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
    raise exception 'Unknown account_sync_changes.collection values remain; refusing to replace account_sync_changes_collection_check';
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
