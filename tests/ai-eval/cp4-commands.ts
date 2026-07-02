import type { ParserNextAction, RuleIntent } from "../../packages/tool-core/src";

export interface Cp4EvalCommand {
  expectedIntent: RuleIntent;
  expectedNextAction: ParserNextAction["type"];
  text: string;
}

export const cp4EvalCommands: Cp4EvalCommand[] = [
  { text: "add product sugar", expectedIntent: "add_product", expectedNextAction: "draft" },
  {
    text: "add 10 packets of maize flour",
    expectedIntent: "add_product",
    expectedNextAction: "draft"
  },
  { text: "new product cooking oil", expectedIntent: "add_product", expectedNextAction: "draft" },
  { text: "ongeza bidhaa unga", expectedIntent: "add_product", expectedNextAction: "draft" },
  { text: "ongeza stock rice 20 kg", expectedIntent: "add_product", expectedNextAction: "draft" },
  { text: "weka bidhaa blue band", expectedIntent: "add_product", expectedNextAction: "draft" },
  { text: "add stock for soap", expectedIntent: "add_product", expectedNextAction: "draft" },
  { text: "new item soda crate", expectedIntent: "add_product", expectedNextAction: "draft" },
  {
    text: "add product milk 12 packets",
    expectedIntent: "add_product",
    expectedNextAction: "draft"
  },
  { text: "ongeza product bread", expectedIntent: "add_product", expectedNextAction: "draft" },
  { text: "add 5 bags cement", expectedIntent: "add_product", expectedNextAction: "draft" },
  { text: "stock product tea leaves", expectedIntent: "add_product", expectedNextAction: "draft" },
  {
    text: "add customer Mary Wanjiku",
    expectedIntent: "add_customer",
    expectedNextAction: "draft"
  },
  { text: "new customer John Kamau", expectedIntent: "add_customer", expectedNextAction: "draft" },
  { text: "ongeza mteja Amina", expectedIntent: "add_customer", expectedNextAction: "draft" },
  { text: "add client Otieno", expectedIntent: "add_customer", expectedNextAction: "draft" },
  { text: "new mteja Grace", expectedIntent: "add_customer", expectedNextAction: "draft" },
  { text: "customer Peter Mwangi", expectedIntent: "add_customer", expectedNextAction: "draft" },
  { text: "add customer Mama Njeri", expectedIntent: "add_customer", expectedNextAction: "draft" },
  { text: "ongeza customer Brian", expectedIntent: "add_customer", expectedNextAction: "draft" },
  { text: "add mteja shop kwa stage", expectedIntent: "add_customer", expectedNextAction: "draft" },
  { text: "new client Fatuma Ali", expectedIntent: "add_customer", expectedNextAction: "draft" },
  {
    text: "add customer hotel baraka",
    expectedIntent: "add_customer",
    expectedNextAction: "draft"
  },
  { text: "mteja mpya Joseph", expectedIntent: "add_customer", expectedNextAction: "draft" },
  {
    text: "create invoice for Mary",
    expectedIntent: "create_invoice",
    expectedNextAction: "draft"
  },
  { text: "make invoice for John", expectedIntent: "create_invoice", expectedNextAction: "draft" },
  {
    text: "new invoice for Mama Njeri",
    expectedIntent: "create_invoice",
    expectedNextAction: "draft"
  },
  {
    text: "andika ankara ya Otieno",
    expectedIntent: "create_invoice",
    expectedNextAction: "draft"
  },
  {
    text: "invoice customer Grace for sugar",
    expectedIntent: "create_invoice",
    expectedNextAction: "draft"
  },
  { text: "create bill for Amina", expectedIntent: "create_invoice", expectedNextAction: "draft" },
  {
    text: "record payment KES 500 from Mary",
    expectedIntent: "record_payment",
    expectedNextAction: "draft"
  },
  {
    text: "mark paid 1200 from John",
    expectedIntent: "record_payment",
    expectedNextAction: "draft"
  },
  {
    text: "received payment sh 800 from Amina",
    expectedIntent: "record_payment",
    expectedNextAction: "draft"
  },
  {
    text: "malipo ya 700 kwa Otieno",
    expectedIntent: "record_payment",
    expectedNextAction: "draft"
  },
  { text: "mpesa 450 from Grace", expectedIntent: "record_payment", expectedNextAction: "draft" },
  { text: "customer paid 300 bob", expectedIntent: "record_payment", expectedNextAction: "draft" },
  { text: "check debt for Mary", expectedIntent: "check_debt", expectedNextAction: "navigate" },
  { text: "show debt for John", expectedIntent: "check_debt", expectedNextAction: "navigate" },
  { text: "Mary owes how much", expectedIntent: "check_debt", expectedNextAction: "navigate" },
  { text: "ana deni Amina", expectedIntent: "check_debt", expectedNextAction: "navigate" },
  { text: "customer balance Otieno", expectedIntent: "check_debt", expectedNextAction: "navigate" },
  { text: "baki ya Grace", expectedIntent: "check_debt", expectedNextAction: "navigate" },
  { text: "show products", expectedIntent: "show_products", expectedNextAction: "navigate" },
  { text: "list products", expectedIntent: "show_products", expectedNextAction: "navigate" },
  { text: "open products", expectedIntent: "show_products", expectedNextAction: "navigate" },
  { text: "show stock", expectedIntent: "show_products", expectedNextAction: "navigate" },
  { text: "list stock", expectedIntent: "show_products", expectedNextAction: "navigate" },
  { text: "onyesha bidhaa", expectedIntent: "show_products", expectedNextAction: "navigate" },
  { text: "show invoices", expectedIntent: "show_invoices", expectedNextAction: "navigate" },
  { text: "list invoices", expectedIntent: "show_invoices", expectedNextAction: "navigate" },
  { text: "open invoices", expectedIntent: "show_invoices", expectedNextAction: "navigate" },
  { text: "show sales", expectedIntent: "show_invoices", expectedNextAction: "navigate" },
  { text: "onyesha ankara", expectedIntent: "show_invoices", expectedNextAction: "navigate" },
  { text: "invoice list", expectedIntent: "show_invoices", expectedNextAction: "navigate" }
];
