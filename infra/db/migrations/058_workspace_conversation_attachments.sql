create table if not exists cp2_conversation_attachments (
  entity_id text primary key,
  business_id text not null,
  account_id text not null,
  user_id text not null,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_conversation_attachments_conversation_idx
  on cp2_conversation_attachments ((record ->> 'conversationId'), updated_at, entity_id);

create index if not exists cp2_conversation_attachments_message_idx
  on cp2_conversation_attachments ((record ->> 'messageId'))
  where record ->> 'messageId' is not null;

create index if not exists cp2_conversation_attachments_account_idx
  on cp2_conversation_attachments (account_id, updated_at desc);

comment on table cp2_conversation_attachments is
  'Private metadata for managed conversation attachments. User-visible messages reference only attachment IDs and safe metadata.';
