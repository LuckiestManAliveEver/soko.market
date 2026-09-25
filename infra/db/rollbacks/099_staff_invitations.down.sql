-- Reverses 099_staff_invitations.sql. Memberships created by accepted invitations live in
-- business_memberships and are untouched; only the invitation records are dropped.
drop table if exists cp2_staff_invitations;
