# CP18 Global Shop ID

CP18 implements the Soko Global Shop ID concept while CP17 Marketplace Foundation is intentionally bypassed for now.

## Source Concept

Primary source:

- `documentation/Soko_Global_Shop_ID_Concept.docx`

The concept defines every Soko shop by a globally unique Business Agent ID instead of a telephone number. The ID is platform-native, stable across SIM cards and telecom providers, and can be used by customers to search, chat, or transact with the shop.

Example:

```text
The BigFish soko: 254A12567835
```

Where:

- `254` is the country namespace.
- `A` is the Business Agent identifier prefix.
- `12567835` is the unique global shop identifier.

## Product Intent

CP18 makes the Business Agent the permanent digital identity of the storefront.

The shop ID should be printable and shareable across:

- storefront pages
- chat windows
- packaging
- receipts
- QR codes
- customer search
- customer conversations
- marketplace and trust surfaces when those are enabled later

## Frontend Direction

The frontend should treat the Soko ID as the public identifier for a business, not as secondary metadata.

Required first-pass surfaces:

- show the Soko ID prominently in the owner storefront/profile area
- show the Soko ID prominently in the public storefront
- let customers use the ID to start or resume a storefront conversation
- keep phone numbers as contact details, not primary shop identity
- use the compact `countryAidentifier` pattern without telephone punctuation
- support copy/share affordances for packaging, receipts, and QR-code workflows

## Implemented Surfaces

- Every new business receives a stable `sokoId` in the `countryA########` format (for example, `254A12567835`).
- Phone signups infer the country namespace from the owner contact number.
- Email/social signups default to the Kenya namespace until a business-country field exists.
- Business creation emits `business.global_shop_id_created` audit events.
- Public storefront responses include both `agentId` and `sokoId`.
- Public storefront lookup accepts the Soko ID and the legacy generated storefront slug.
- Legacy `+country-A########` identifiers are normalized to the compact canonical format when read.
- Owner profile shows the Soko Global Shop ID with copy actions for the ID and storefront URL.
- Public storefront chat shows the Soko ID in the header and greeting.
- Storefront URLs are now generated from the Soko ID.
- Existing locally stored businesses are migrated to a fallback Soko ID for frontend continuity.

## Identity Rules

- A Soko ID must be globally unique.
- A Soko ID must remain stable for the lifetime of the business unless an explicit recovery or migration process is introduced.
- A Soko ID belongs to the Business Agent identity, not a SIM card, phone number, or individual device.
- Customer-facing chat and transaction entry points should resolve through the Soko ID.
- The generated ID must be auditable and deterministic enough to avoid collisions in production.

## CP17 Bypass

CP17 Marketplace Foundation remains deferred. CP18 can proceed because the Global Shop ID is a core identity and storefront concern, not a marketplace plugin system.

Marketplace-specific work remains out of scope:

- third-party skills
- skill package installation
- external developer APIs
- marketplace permission grants
- plugin trust workflows

## Exit Criteria

CP18 is complete when:

- every business has a stable Soko Global Shop ID
- owner UI displays and shares the ID
- public storefront UI displays the ID
- storefront conversation entry can be driven by the ID
- ID creation and lookup are covered by tests
- phone numbers no longer act as the primary customer-facing shop identifier
- the checkpoint log is updated

## Rollback

If CP18 must be rolled back, hide the Soko ID surfaces while preserving generated IDs in storage. Existing storefront URLs, business IDs, and phone-contact workflows should continue to work.
