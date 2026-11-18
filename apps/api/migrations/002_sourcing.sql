-- Phase 4: sourcing (RFQ, quotes, awards) and exception management.
ALTER TABLE suppliers ADD COLUMN is_procmart boolean NOT NULL DEFAULT false;  -- ProcMart as a bidder is gated by policy Q2

CREATE SEQUENCE rfq_seq;
CREATE TABLE rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text NOT NULL,
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  plant_node_id uuid NOT NULL REFERENCES org_nodes(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','awarded','cancelled')),
  min_quotes int NOT NULL CHECK (min_quotes >= 1),     -- snapshot of customer policy at creation
  closes_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE TABLE rfq_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  rfq_id uuid NOT NULL REFERENCES rfqs(id),
  requirement_line_id uuid NOT NULL REFERENCES requirement_lines(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  qty numeric(18,4) NOT NULL,
  uom text NOT NULL,
  recommended_quote_line_id uuid,
  recommended_by uuid,
  UNIQUE (rfq_id, requirement_line_id)
);
CREATE TABLE rfq_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  rfq_id uuid NOT NULL REFERENCES rfqs(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  UNIQUE (rfq_id, supplier_id)
);
CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  rfq_id uuid NOT NULL REFERENCES rfqs(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  entered_by uuid NOT NULL,                              -- ProcMart ops on the supplier's behalf until the supplier portal exists
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, supplier_id)
);
CREATE TABLE quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  quote_id uuid NOT NULL REFERENCES quotes(id),
  rfq_line_id uuid NOT NULL REFERENCES rfq_lines(id),
  unit_price numeric(18,4) NOT NULL CHECK (unit_price > 0),
  freight_per_unit numeric(18,4) NOT NULL DEFAULT 0 CHECK (freight_per_unit >= 0),
  landed_unit_cost numeric(18,4) GENERATED ALWAYS AS (unit_price + freight_per_unit) STORED,   -- excl. GST
  lead_time_days int CHECK (lead_time_days >= 0),
  uom text NOT NULL,
  UNIQUE (quote_id, rfq_line_id)
);
ALTER TABLE rfq_lines ADD FOREIGN KEY (recommended_quote_line_id) REFERENCES quote_lines(id);
CREATE TABLE awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  rfq_id uuid NOT NULL REFERENCES rfqs(id),
  rfq_line_id uuid NOT NULL REFERENCES rfq_lines(id) UNIQUE,
  quote_line_id uuid NOT NULL REFERENCES quote_lines(id),
  is_l1 boolean NOT NULL,
  reason text,
  awarded_by uuid NOT NULL,
  stream_id uuid REFERENCES streams(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_l1 OR coalesce(length(trim(reason)),0) > 0)   -- a non-L1 award always carries a recorded reason
);
CREATE TABLE exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL,
  requirement_id uuid REFERENCES requirements(id),
  requirement_line_id uuid REFERENCES requirement_lines(id),
  stream_id uuid REFERENCES streams(id),
  rfq_id uuid REFERENCES rfqs(id),
  detail text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (status = 'open' OR (resolution IS NOT NULL AND resolved_by IS NOT NULL))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rfqs','rfq_lines','rfq_invitations','quotes','quote_lines','awards','exceptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
