update cp2_conversation_attachments as attachment
set record = (attachment.record - 'storageKey') || jsonb_build_object(
  'contentBase64',
  encode(blob.content, 'base64')
)
from cp2_conversation_attachment_blobs as blob
where blob.storage_key = attachment.record ->> 'storageKey';

drop table if exists cp2_conversation_attachment_blobs;
