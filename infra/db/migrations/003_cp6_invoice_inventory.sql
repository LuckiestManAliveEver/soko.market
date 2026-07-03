CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  invoice_number text NOT NULL,
  status text NOT NULL,
  customer_id uuid REFERENCES customers (id),
  customer_name text,
  subtotal numeric NOT NULL,
  tax_rate numeric NOT NULL,
  tax_total numeric NOT NULL,
  total numeric NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices (id),
  product_id uuid NOT NULL REFERENCES products (id),
  product_name text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  line_total numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_number_counters (
  business_id uuid PRIMARY KEY REFERENCES businesses (id),
  next_number integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_business_number_idx
  ON invoices (business_id, invoice_number);

CREATE INDEX IF NOT EXISTS invoices_business_status_idx
  ON invoices (business_id, status, created_at);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx
  ON invoice_items (invoice_id);
