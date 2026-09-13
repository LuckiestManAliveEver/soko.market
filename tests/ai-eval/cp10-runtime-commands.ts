import type { RuntimeToolName } from "../../packages/shared-types/src";

export interface Cp10RuntimeEvalCommand {
  text: string;
  expectedTool: RuntimeToolName;
  expectedRequiresConfirmation: boolean;
}

export const cp10RuntimeEvalCommands: Cp10RuntimeEvalCommand[] = [
  {
    text: "show products",
    expectedTool: "products.list",
    expectedRequiresConfirmation: false
  },
  {
    text: "list stock",
    expectedTool: "products.list",
    expectedRequiresConfirmation: false
  },
  {
    text: "onyesha bidhaa",
    expectedTool: "products.list",
    expectedRequiresConfirmation: false
  },
  {
    text: "show invoices",
    expectedTool: "invoices.list",
    expectedRequiresConfirmation: false
  },
  {
    text: "list sales",
    expectedTool: "invoices.list",
    expectedRequiresConfirmation: false
  },
  {
    text: "add product sugar",
    expectedTool: "product.create",
    expectedRequiresConfirmation: false
  },
  {
    text: "ongeza bidhaa rice",
    expectedTool: "product.create",
    expectedRequiresConfirmation: false
  },
  {
    text: "add 10 packets of maize flour",
    expectedTool: "product.create",
    expectedRequiresConfirmation: false
  },
  {
    text: "add customer Mary",
    expectedTool: "customer.create",
    expectedRequiresConfirmation: true
  },
  {
    text: "new customer Asha",
    expectedTool: "customer.create",
    expectedRequiresConfirmation: true
  },
  {
    text: "create invoice for Mary",
    expectedTool: "invoice.draft",
    expectedRequiresConfirmation: true
  },
  {
    text: "record payment KES 500 from Mary",
    expectedTool: "payment.record",
    expectedRequiresConfirmation: true
  },
  {
    text: "show reports",
    expectedTool: "reports.summary",
    expectedRequiresConfirmation: false
  },
  {
    text: "onyesha ripoti",
    expectedTool: "reports.summary",
    expectedRequiresConfirmation: false
  },
  {
    text: "show notifications",
    expectedTool: "notifications.list",
    expectedRequiresConfirmation: false
  },
  {
    text: "check debt for Mary",
    expectedTool: "payments.debtors",
    expectedRequiresConfirmation: false
  },
  {
    text: "update product sugar quantity 20",
    expectedTool: "product.update",
    expectedRequiresConfirmation: true
  },
  {
    text: "adjust stock sugar to 15",
    expectedTool: "product.stock_adjust",
    expectedRequiresConfirmation: false
  },
  {
    text: "update customer Mary phone 0712345678",
    expectedTool: "customer.update",
    expectedRequiresConfirmation: true
  },
  {
    text: "add supplier John 0712345678",
    expectedTool: "supplier.create",
    expectedRequiresConfirmation: true
  },
  {
    text: "update supplier John phone 0712345678",
    expectedTool: "supplier.update",
    expectedRequiresConfirmation: true
  },
  {
    text: "mark delivered for Mary",
    expectedTool: "logistics.update_status",
    expectedRequiresConfirmation: true
  },
  {
    text: "asdkj qweoiu random gibberish text",
    expectedTool: "unknown.clarify",
    expectedRequiresConfirmation: false
  }
];
