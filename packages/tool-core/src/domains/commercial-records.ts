import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const commercialRecordsRuntimeTools = {
  "contacts.search": tool(
    "contacts.search",
    "Search permissioned canonical contacts.",
    "customer:read",
    true,
    false,
    { query: field("string", "Name, phone, or email fragment.") }
  ),
  "supplier.contact.attach": tool(
    "supplier.contact.attach",
    "Attach a canonical contact to a supplier with a business role.",
    "supplier:write",
    false,
    true,
    {
      supplierId: field("string", "Canonical supplier ID.", true),
      contactId: field("string", "Canonical contact ID.", true),
      role: field(
        "string",
        "OWNER, SALES_AGENT, DELIVERY_AGENT, DRIVER, ACCOUNT_MANAGER, or OTHER.",
        true
      ),
      isPrimary: field("boolean", "Whether this is the primary contact for the role.")
    }
  ),
  "purchase.record": tool(
    "purchase.record",
    "Record an immutable supplier purchase and its buying price.",
    "import:write",
    false,
    true,
    {
      supplierId: field("string", "Canonical supplier ID.", true),
      supplierContactId: field("string", "Supplier contact involved."),
      productId: field("string", "Canonical product ID.", true),
      quantity: field("number", "Purchased quantity.", true),
      buyingPrice: field("number", "Buying price per unit.", true),
      currency: field("string", "ISO currency code."),
      deliveredAt: field("string", "Delivery timestamp."),
      routeId: field("string", "Delivery route ID."),
      externalSourceId: field("string", "Stable idempotency key.")
    }
  ),
  "purchase.price.change": tool(
    "purchase.price.change",
    "Append a new effective buying-price record while preserving previous prices.",
    "product:write",
    false,
    true,
    {
      productId: field("string", "Canonical product ID.", true),
      price: field("number", "New buying price.", true),
      currency: field("string", "ISO currency code."),
      supplierId: field("string", "Supplier context."),
      supplierContactId: field("string", "Supplier agent context."),
      effectiveAt: field("string", "Effective timestamp.")
    }
  ),
  "purchase.history": tool(
    "purchase.history",
    "Retrieve immutable purchase history.",
    "import:read",
    true,
    false,
    {
      productId: field("string", "Optional product filter."),
      supplierId: field("string", "Optional supplier filter.")
    }
  ),
  "sale.record": tool(
    "sale.record",
    "Record and confirm an immutable customer sale.",
    "invoice:confirm",
    false,
    true,
    {
      customerId: field("string", "Optional customer ID."),
      customerName: field("string", "Customer or walk-in name."),
      customerContactId: field("string", "Canonical contact ID."),
      items: field("array", "Product, quantity, and unit-price lines.", true),
      currency: field("string", "ISO currency code."),
      routeId: field("string", "Fulfilment route ID."),
      externalSourceId: field("string", "Stable idempotency key.")
    }
  ),
  "sales.history": tool(
    "sales.history",
    "Retrieve immutable sales history.",
    "invoice:read",
    true,
    false,
    {
      customerId: field("string", "Optional customer filter."),
      customerContactId: field("string", "Optional contact filter.")
    }
  ),
  "route.record": tool(
    "route.record",
    "Record a provider-neutral delivery route with origin, destination, and stops.",
    "logistics:write",
    false,
    true,
    {
      origin: field("object", "Origin location.", true),
      destination: field("object", "Destination location.", true),
      stops: field("array", "Optional ordered intermediate stops."),
      provider: field("string", "Optional map provider; manual by default."),
      externalSourceId: field("string", "Stable idempotency key.")
    }
  ),
  "route.history": tool(
    "route.history",
    "Retrieve immutable delivery route history.",
    "logistics:read",
    true,
    false,
    { destinationLocationId: field("string", "Optional destination filter.") }
  )
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;

function field(
  type: "string" | "number" | "boolean" | "array" | "object",
  description: string,
  required = false
) {
  return { type, description, ...(required ? { required: true } : {}) };
}
function tool(
  name: RuntimeToolName,
  description: string,
  requiredPermission: string,
  readOnly: boolean,
  requiresConfirmation: boolean,
  properties: RuntimeToolDefinition["inputSchema"]["properties"]
): RuntimeToolDefinition {
  return {
    name,
    description,
    risk: readOnly ? "low" : "high",
    requiresConfirmation,
    readOnly,
    requiredPermission,
    inputSchema: { type: "object", properties },
    mcpExposable: false
  };
}
