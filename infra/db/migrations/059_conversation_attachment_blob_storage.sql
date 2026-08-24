create table if not exists cp2_conversation_attachment_blobs (
  storage_key text primary key,
  content bytea not null,
  checksum text not null,
  mime_type text not null,
  updated_at timestamp with time zone not null default now()
);

insert into cp2_conversation_attachment_blobs (storage_key, content, checksum, mime_type, updated_at)
select
  'conversation-attachments/' || entity_id,
  decode(record ->> 'contentBase64', 'base64'),
  record ->> 'checksum',
  record ->> 'mimeType',
  updated_at
from cp2_conversation_attachments
where record ? 'contentBase64'
on conflict (storage_key) do nothing;

update cp2_conversation_attachments
set record = (record - 'contentBase64') || jsonb_build_object(
  'storageKey',
  'conversation-attachments/' || entity_id
)
where record ? 'contentBase64';

comment on table cp2_conversation_attachment_blobs is
  'Private bytea-backed conversation attachment objects. Metadata remains in cp2_conversation_attachments.';
