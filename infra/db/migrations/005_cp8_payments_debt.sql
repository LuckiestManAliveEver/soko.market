CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  customer_id uuid REFERENCES customers(id),
  method text NOT NULL,
  amount numeric NOT NULL,
  reference text,
  note text,
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS payments_business_id_created_at_idx
  ON payments (business_id, created_at);

CREATE INDEX IF NOT EXISTS payments_invoice_id_created_at_idx
  ON payments (invoice_id, created_at);

CREATE INDEX IF NOT EXISTS payments_customer_id_created_at_idx
  ON payments (customer_id, created_at);
