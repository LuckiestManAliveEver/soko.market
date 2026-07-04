# CP13 Logistics

CP13 adds deterministic in-app logistics tracking for confirmed invoices.

## Fulfillment Records

A logistics record is business-scoped and linked to one confirmed invoice. CP13 supports:

- `delivery`
- `pickup`

Each invoice can have at most one logistics record in CP13. Logistics records copy bounded invoice references such as invoice id, invoice number, customer id, and customer name for owner workflow display. Logistics records do not change invoice totals, inventory quantities, payments, or customer debt.

## Status Lifecycle

Supported statuses:

- `pending`
- `ready`
- `out_for_delivery`
- `completed`
- `cancelled`

Allowed transitions:

| Current            | Delivery next                                | Pickup next              |
| ------------------ | -------------------------------------------- | ------------------------ |
| `pending`          | `ready`, `cancelled`                         | `ready`, `cancelled`     |
| `ready`            | `out_for_delivery`, `completed`, `cancelled` | `completed`, `cancelled` |
| `out_for_delivery` | `completed`, `cancelled`                     | none                     |
| `completed`        | none                                         | none                     |
| `cancelled`        | none                                         | none                     |

Creation and status changes emit business events. Reopening completed or cancelled fulfillment is rejected.

## Boundaries

CP13 is in-app only. It does not integrate carriers, maps, route optimization, SMS, email, WhatsApp, push, driver assignment, or marketplace courier workflows.

Runtime and local-model context receive bounded counts only:

- total logistics records
- active logistics records
- report-level status counts

Raw customer destinations and route-like details are not included in runtime facts, telemetry, or local-model prompt context.
