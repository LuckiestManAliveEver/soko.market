# Phonebook identity resolution

> People are entities. Applications are capabilities. Identifiers are attributes.

Soko does not require an email or social integration as a prerequisite for building a
relationship graph. The user's phone/social contact graph, already owned by
`NetworkDomain` (`services/api/src/cp2/domains/network/store.ts`), is the seed. Email, social
handles, and Soko accounts are identities attached to a phonebook contact, not the foundation of
the contact model.

## Existing architecture reused

This is not a new store. `NetworkDomain` already modeled almost everything this needed:
`networkNodes` (the phonebook contacts, called nodes for historical reasons -
`requirePhonebookNode` predates this doc), `externalIdentities`, and `sokoIdentityLinks`. What was
missing was the fine-grained capability surface and the provenance/confirmation rules for identity
facts that don't come from an owner-initiated sync. This change extends that same domain: no
parallel phonebook was created. See `docs/architecture/commercial-history.md`'s "Existing
architecture reused" section for the sibling decision this mirrors - canonical business contacts
(tenant-scoped, for supplier/customer CRM) stay a separate, already-documented concept from this
one (personal, user-scoped). Neither should be confused with the other or merged.

## Provenance

Every `ExternalIdentitySummary` and `SokoIdentityLinkSummary` carries an `IdentityProvenance`:

- `user_entered` - the owner typed it themselves (`addManualIdentity`). Trusted immediately; no
  confirmation step, because the owner's own input already is the confirmation.
- `imported` - came from a phone or social contact sync the owner explicitly triggered
  (`syncPhoneContacts`, `syncSocialNetwork`) or from auto-linking a contact to an existing Soko
  account by matching a hashed phone/email against that account's primary auth destination
  (`findSokoIdentityLink`).
- `verified` - came from an OAuth-authenticated provider connection (`syncConnectedSocialProvider`,
  or a Google Contacts fetch using a stored OAuth token).
- `observed` - came from an external observation the owner did not directly initiate - today, a
  ComputerRuntime browsing session reading untrusted web content while completing some other task.

## The observed path never mutates the phonebook directly

`NetworkDomain.proposeIdentityCandidate` is the _only_ entry point external observations may use.
It never touches `networkNodes` or `externalIdentities` - it only ever creates a pending
`IdentityCandidateSummary`, with a best-effort `nodeId` guess (an exact, case-insensitive
display-name match - see `findBestNodeMatchForCandidate` - never a fuzzy or partial match, and
never auto-attached). A pending candidate becomes a real identity only through
`confirmIdentityCandidate`, which requires the owner's own pin-verified session and either accepts
the guessed contact, redirects it to a different existing contact (`targetNodeId`), or creates a
brand-new contact (`createNewContact`). `rejectIdentityCandidate` discards a candidate without ever
attaching it. Re-proposing the same observed identity while a candidate is still pending is
idempotent (returns the existing candidate rather than duplicating it); proposing an identity that
is already confirmed is rejected outright.

This is structurally enforced, not just a convention: `computer.*` runtime-tool actions never reach
the capability dispatcher that can call `network.identity.*` (see
`services/api/src/cp2/domains/agent-runtime/capabilities.ts` - every `computer.*` toolName is
intercepted and routed to RuntimeHandoff/the isolated browser provider before the dispatcher's
`switch` is ever reached). An agent acting on a ComputerRuntime observation has to make a separate,
explicit `network.identity.propose` call with a plain-language `evidence` string - it cannot smuggle
a direct phonebook write through the browsing tool call itself.

```text
external observation (e.g. computer.observe)
      |
      v
network.identity.propose  -->  IdentityCandidateSummary (status: pending)
      |
      +-- network.identity.reject  --> discarded, never attached
      |
      v
network.identity.confirm (owner, pin-verified session)
      |
      v
ExternalIdentitySummary (provenance: "observed") attached to a NetworkNodeSummary
```

## Capabilities

All are user-scoped (`requirePinVerifiedSession`, no `businessId`), matching every other
`NetworkDomain` capability:

| Tool name                  | Store method               | Purpose                                                                                                                                                                     |
| -------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network.contacts.resolve` | `resolveContact`           | "Who is this?" - resolve a name/phone/email/handle against the owner's own phonebook, ranked phone/email hash match > confirmed handle match > exact name > substring name. |
| `network.identity.list`    | `listIdentityCandidates`   | List pending identity candidates awaiting confirmation.                                                                                                                     |
| `network.identity.propose` | `proposeIdentityCandidate` | Record an observed identity as pending. Never mutates the phonebook.                                                                                                        |
| `network.identity.confirm` | `confirmIdentityCandidate` | Attach a pending candidate's identity to an existing or brand-new contact.                                                                                                  |
| `network.identity.reject`  | `rejectIdentityCandidate`  | Discard a pending candidate.                                                                                                                                                |
| `network.identity.unlink`  | `unlinkIdentity`           | Remove a previously attached identity from a contact (correcting a bad link).                                                                                               |
| `network.identity.add`     | `addManualIdentity`        | Directly attach an owner-authored identity (provenance `user_entered`).                                                                                                     |

`NetworkNodeSummary.externalIdentityIds` is an array (not a single nullable id) precisely so one
contact can accumulate a phone, an email, an Instagram handle, a WhatsApp number, and a linked Soko
account without becoming multiple phonebook entries.

## What this deliberately does not do

- It does not silently merge two people because their names are similar. `findBestNodeMatchForCandidate`
  only ever proposes an _exact_ case-insensitive display-name match, and even then the result is a
  guess a human still has to confirm.
- It does not require email or a specific social provider to exist before a contact can be
  resolved - phone-only phonebook contacts (from `syncPhoneContacts`) are resolvable by name and
  phone from day one.
- It does not give ComputerRuntime provider code, or any `computer.*` tool call, a direct write
  path into `networkNodes`/`externalIdentities`.
