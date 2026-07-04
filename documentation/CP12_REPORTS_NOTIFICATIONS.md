# CP12 Reports, Notifications, and Knowledge

CP12 adds deterministic owner-facing reports, in-app notification records, and bounded knowledge summaries.

## Report Definitions

Reports are generated from existing business-scoped records:

- Sales: invoice counts, confirmed sales total, collected total, and outstanding total.
- Inventory: product count, units on hand, low-stock count, out-of-stock count, and inventory movement count.
- Payments: payment count, paid/partial/unpaid invoice counts, and total paid.
- Debt: customers with outstanding balances, total outstanding, and largest balance.
- Imports: previewed, confirmed, failed, and confirmed row counts.
- Sync health: pending, processing, synced, failed, conflict, total, and active sync queue counts.

Reports are read-only and do not mutate source records.

## Notification Boundaries

CP12 notifications are in-app only. External SMS, email, WhatsApp, push, scheduled delivery, provider retry, and delivery monitoring are deferred.

Notification records are generated from deterministic rules:

- low or out-of-stock inventory
- open customer debt
- sync conflicts
- failed document imports

Notification state can be updated to `unread`, `read`, or `archived`. State changes are audited and do not mutate products, invoices, payments, imports, or sync queue records.

## Runtime Knowledge

Knowledge summaries expose bounded facts and metrics to the owner UI and runtime context. They avoid raw customer, product, supplier, invoice, payment, import source, or prompt text in model-facing context.

Runtime-visible CP12 context is limited to counts and totals such as low-stock count, outstanding debt total, unread notification count, and knowledge fact count. Business mutations still require existing deterministic validators and CP10 confirmation gates.
