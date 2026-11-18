-- Source-of-supply redesign: aliases (how people really describe items), approved alternatives, coverage requests,
-- non-catalogue requests, buyer intent, and imported PO history (stand-in for a SAP PO feed).
CREATE TABLE item_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  kind text NOT NULL CHECK (kind IN ('sap_description','supplier_code','common_name','application')),
  value text NOT NULL,
  supplier_id uuid REFERENCES suppliers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, kind, value)
);
CREATE INDEX item_aliases_trgm ON item_aliases USING gin (lower(value) gin_trgm_ops);
ALTER TABLE catalogue_items ADD COLUMN source text NOT NULL DEFAULT 'catalogue' CHECK (source IN ('catalogue','requested')), ADD COLUMN requested_by uuid;
CREATE TABLE item_alternatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  alternative_item_id uuid NOT NULL REFERENCES catalogue_items(id),
  note text,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, alternative_item_id), CHECK (item_id <> alternative_item_id)
);
CREATE TABLE coverage_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  plant_node_id uuid NOT NULL REFERENCES org_nodes(id),
  contract_id uuid REFERENCES contracts(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR (resolution IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE UNIQUE INDEX coverage_requests_one_open ON coverage_requests(item_id, plant_node_id) WHERE status = 'open';
ALTER TABLE cart_lines ADD COLUMN intent text NOT NULL DEFAULT 'buy' CHECK (intent IN ('buy','source')), ADD COLUMN note text;
ALTER TABLE requirement_lines ADD COLUMN intent text NOT NULL DEFAULT 'buy', ADD COLUMN note text;
CREATE TABLE po_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source text NOT NULL DEFAULT 'sap_po_feed_simulated',
  po_number text NOT NULL,
  po_date date NOT NULL,
  plant_node_id uuid NOT NULL REFERENCES org_nodes(id),
  item_id uuid REFERENCES catalogue_items(id),
  material_code text,
  vendor_code text,
  vendor_name text,
  supplier_id uuid REFERENCES suppliers(id),
  qty numeric(18,4) NOT NULL,
  uom text,
  unit_price numeric(18,4) NOT NULL,
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX po_history_item ON po_history(item_id, po_date);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_aliases','item_alternatives','coverage_requests','po_history'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
