import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const productsRuntimeTools = {
  "product.create": {
    name: "product.create",
    hub: { module: "catalog", label: { en: "Add a product", sw: "Ongeza bidhaa" } },
    description: "Create a new catalogue product with a name, unit, and starting quantity.",
    risk: "high",
    // Auto-accepted: creating a product is trivially reversible (edit or delete it after), and
    // carries no money movement - unlike product.update/product.delete, which stay confirmed.
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", required: true, description: "Product name." },
        unit: {
          type: "string",
          required: true,
          description: 'Stock-keeping unit, e.g. "kg" or "unit".'
        },
        quantity: { type: "number", description: "Starting stock quantity." },
        sellingPrice: { type: "number", description: "Selling price, if mentioned." }
      }
    },
    mcpExposable: false
  },
  "product.update": {
    name: "product.update",
    hub: { module: "catalog", label: { en: "Edit a product", sw: "Hariri bidhaa" } },
    description: "Update an existing catalogue product's details.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        productName: { type: "string", required: true, description: "Product to update." },
        unit: { type: "string", description: "New stock-keeping unit, if changing." },
        quantity: { type: "number", description: "New quantity, if changing." },
        sellingPrice: { type: "number", description: "New selling price, if changing." }
      }
    },
    mcpExposable: false
  },
  "product.delete": {
    name: "product.delete",
    hub: { module: "catalog", label: { en: "Remove a product", sw: "Ondoa bidhaa" } },
    description: "Permanently delete a catalogue product.",
    risk: "critical",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        productName: { type: "string", required: true, description: "Product to delete." }
      }
    },
    mcpExposable: false
  },
  "product.stock_adjust": {
    name: "product.stock_adjust",
    hub: { module: "catalog", label: { en: "Adjust stock", sw: "Rekebisha stoki" } },
    description: "Adjust a catalogue product's on-hand stock quantity.",
    risk: "high",
    // Auto-accepted: a stock quantity is easily corrected with another adjustment if wrong, and
    // carries no money movement.
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        productName: { type: "string", required: true, description: "Product to adjust." },
        quantity: {
          type: "number",
          required: true,
          description: "New quantity or quantity delta."
        }
      }
    },
    mcpExposable: false
  },
  "product.field.add": {
    name: "product.field.add",
    hub: { module: "catalog", label: { en: "Add a product field", sw: "Ongeza sehemu ya bidhaa" } },
    description: "Add a custom field to the product schema.",
    risk: "medium",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        fieldName: { type: "string", required: true, description: "Custom field name to add." },
        fieldId: {
          type: "string",
          description: "Stable field ID; generated from the name if omitted."
        },
        inputType: {
          type: "string",
          description: "Field input type: text, number, select, textarea, or yes_no."
        },
        required: { type: "boolean", description: "Whether products require this field." }
      }
    },
    mcpExposable: false
  },
  "product.field.remove": {
    name: "product.field.remove",
    hub: {
      module: "catalog",
      label: { en: "Remove a product field", sw: "Ondoa sehemu ya bidhaa" }
    },
    description: "Remove a custom field from the product schema.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "product:write",
    inputSchema: {
      type: "object",
      properties: {
        fieldName: { type: "string", required: true, description: "Custom field name to remove." }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
