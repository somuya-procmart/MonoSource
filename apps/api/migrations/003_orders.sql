-- Phase 5: supplier operations, delivery tracking, GRN/invoice mirrors, follow-ups.
ALTER TABLE suppliers ADD COLUMN contact_email text, ADD COLUMN contact_phone text;

ALTER TABLE streams DROP CONSTRAINT streams_status_check;
ALTER TABLE streams ADD CONSTRAINT streams_status_check CHECK (status IN
  ('routed','pr_requested','pr_created','pr_failed','po_released','acknowledged','partially_dispatched','dispatched',
   'delivered','partially_received','grn_posted','invoiced','paid','closed'));
ALTER TABLE streams ADD COLUMN status_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION streams_touch_status() RETURNS trigger AS $$
BEGIN IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.status_at = now(); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER streams_status_at BEFORE UPDATE ON streams FOR EACH ROW EXECUTE FUNCTION streams_touch_status();

-- Supplier commitment per order line (acknowledgement). Partial/reject need a human (decision Q11 open).
CREATE TABLE line_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requirement_line_id uuid NOT NULL REFERENCES requirement_lines(id) UNIQUE,
  qty_committed numeric(18,4) NOT NULL CHECK (qty_committed >= 0),
  committed_date date,
  note text,
  by_user uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE asn_seq;
CREATE TABLE shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  stream_id uuid NOT NULL REFERENCES streams(id),
  asn_number text NOT NULL,
  invoice_number text,
  eway_bill text,
  carrier text,
  tracking_ref text,
  expected_date date,
  by_user uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, asn_number)
);
CREATE TABLE shipment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  requirement_line_id uuid NOT NULL REFERENCES requirement_lines(id),
  qty numeric(18,4) NOT NULL CHECK (qty > 0)
);
-- GRN is posted in the customer's ERP. Until a real feed exists the rows below are SIMULATED mirrors (simulated=true always).
CREATE TABLE grn_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  stream_id uuid NOT NULL REFERENCES streams(id),
  requirement_line_id uuid NOT NULL REFERENCES requirement_lines(id),
  qty_accepted numeric(18,4) NOT NULL CHECK (qty_accepted >= 0),
  qty_rejected numeric(18,4) NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
  grn_number text NOT NULL,
  simulated boolean NOT NULL DEFAULT true,
  by_user uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  stream_id uuid NOT NULL REFERENCES streams(id),
  invoice_number text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','verified','paid')),
  by_user uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stream_id, invoice_number)
);
CREATE TABLE follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  stream_id uuid NOT NULL REFERENCES streams(id),
  kind text NOT NULL CHECK (kind IN ('ack','dispatch','delivery')),
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','call')),
  status text NOT NULL CHECK (status IN ('sent','failed')),
  detail text,
  simulated boolean NOT NULL DEFAULT true,
  at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['line_commitments','shipments','shipment_lines','grn_receipts','invoices','follow_ups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
