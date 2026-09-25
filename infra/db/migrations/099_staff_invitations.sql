-- Staff invitations (docs/architecture/staff-invitations.md): an owner or manager invites a phone
-- number or email into their business with a role; accepting creates an ordinary row in
-- business_memberships. Same generic Cp2 collection shape as the other snapshot collections
-- (023_storefront_interaction_contracts.sql): the record is the StaffInvitationSummary JSON.
create table if not exists cp2_staff_invitations (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_staff_invitations_business_idx
  on cp2_staff_invitations (business_id) where business_id is not null;

create index if not exists cp2_staff_invitations_user_idx
  on cp2_staff_invitations (user_id) where user_id is not null;

comment on table cp2_staff_invitations is
  'Invitations to join a business with a role; acceptance creates a business_memberships row.';
