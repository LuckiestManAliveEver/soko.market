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
  }
];
