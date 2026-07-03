CREATE TABLE IF NOT EXISTS document_import_sources (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id),
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS document_import_jobs (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id),
  source_id uuid NOT NULL REFERENCES document_import_sources(id),
  target text NOT NULL,
  status text NOT NULL,
  field_mapping jsonb NOT NULL,
  confirmed_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  confirmed_at timestamptz
);

CREATE TABLE IF NOT EXISTS document_import_rows (
  id uuid PRIMARY KEY,
  import_job_id uuid NOT NULL REFERENCES document_import_jobs(id),
  row_number integer NOT NULL,
  raw jsonb NOT NULL,
  mapped jsonb NOT NULL,
  errors jsonb NOT NULL,
  warnings jsonb NOT NULL,
  selected integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS document_import_sources_business_id_created_at_idx
  ON document_import_sources (business_id, created_at);

CREATE INDEX IF NOT EXISTS document_import_jobs_business_id_created_at_idx
  ON document_import_jobs (business_id, created_at);

CREATE INDEX IF NOT EXISTS document_import_rows_import_job_id_row_number_idx
  ON document_import_rows (import_job_id, row_number);
