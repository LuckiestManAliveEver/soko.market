CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  name text NOT NULL,
  sku text,
  unit text NOT NULL,
  quantity numeric NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  name text NOT NULL,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  name text NOT NULL,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id),
  product_id uuid NOT NULL REFERENCES products (id),
  type text NOT NULL,
  quantity_before numeric NOT NULL,
  quantity_after numeric NOT NULL,
  delta numeric NOT NULL,
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS products_business_idx
  ON products (business_id, name);

CREATE INDEX IF NOT EXISTS customers_business_idx
  ON customers (business_id, name);

CREATE INDEX IF NOT EXISTS suppliers_business_idx
  ON suppliers (business_id, name);

CREATE INDEX IF NOT EXISTS inventory_movements_product_idx
  ON inventory_movements (business_id, product_id, created_at);
