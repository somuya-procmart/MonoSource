-- MonoSource schema v1. Every tenant table gets RLS at the bottom of this file.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────── tenancy ─────────
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer','platform')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_policies (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  -- NULL means "not decided yet" (decision register Q1/Q2/Q12). Routing must not assume.
  arc_priority_over_direct boolean,
  procmart_may_bid boolean,
  thresholds jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE erp_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,                       -- e.g. "SAP-S01": the server context
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sap','ariba','oracle','procmart','mock-sap')),
  config jsonb NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, code)
);

CREATE TABLE org_level_types (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  label text NOT NULL,
  rank int NOT NULL,                        -- lower = higher in hierarchy
  PRIMARY KEY (tenant_id, key),
  UNIQUE (tenant_id, rank)
);

CREATE TABLE org_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  parent_id uuid REFERENCES org_nodes(id),
  level_type text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  erp_system_id uuid REFERENCES erp_systems(id),   -- plant identity = (server, code)
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('sync','import','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, level_type) REFERENCES org_level_types(tenant_id, key)
);
CREATE UNIQUE INDEX org_nodes_identity ON org_nodes
  (tenant_id, level_type, coalesce(erp_system_id,'00000000-0000-0000-0000-000000000000'), code);
CREATE INDEX org_nodes_parent ON org_nodes(parent_id);

-- ───────── identity ─────────
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  kind text NOT NULL DEFAULT 'staff' CHECK (kind IN ('staff','supplier')),
  supplier_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  name text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, key)
);

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role_id uuid NOT NULL REFERENCES roles(id),
  scope_node_id uuid REFERENCES org_nodes(id),     -- NULL = whole tenant; otherwise that node's subtree
  UNIQUE (user_id, role_id, scope_node_id)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();

-- ───────── suppliers ─────────
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  legal_name text NOT NULL,
  tax_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('onboarding','active','blocked')),
  fee_terms_accepted boolean,                       -- Q5: NULL = not asked
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Same name or tax id does NOT merge suppliers; identities stay per source system.
CREATE TABLE supplier_erp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  erp_system_id uuid NOT NULL REFERENCES erp_systems(id),
  vendor_code text NOT NULL,
  UNIQUE (tenant_id, erp_system_id, vendor_code)
);

-- ───────── catalogue ─────────
CREATE TABLE catalogue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  manufacturer text,
  brand text,
  mpn text,
  uom text NOT NULL,
  category text,
  specs jsonb NOT NULL DEFAULT '{}',
  procmart_serviceability text CHECK (procmart_serviceability IN ('arc','qrc','on_quote','non_serviceable')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  version int NOT NULL DEFAULT 1,
  search tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name,'')||' '||coalesce(description,'')||' '||coalesce(brand,'')||' '||coalesce(mpn,'')||' '||coalesce(category,''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalogue_items_search ON catalogue_items USING gin(search);
CREATE INDEX catalogue_items_trgm ON catalogue_items USING gin (name gin_trgm_ops);

CREATE TABLE catalogue_item_versions (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid,
  at timestamptz NOT NULL DEFAULT now()
);

-- Customer material code, always within an ERP/server context.
CREATE TABLE item_erp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  erp_system_id uuid NOT NULL REFERENCES erp_systems(id),
  material_code text NOT NULL,
  UNIQUE (tenant_id, erp_system_id, material_code)
);

-- ───────── documents & contracts ─────────
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  filename text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_type text NOT NULL CHECK (contract_type IN ('ARC','QRC','PROCMART_DIRECT')),
  number text,
  supplier_id uuid REFERENCES suppliers(id),
  erp_system_id uuid REFERENCES erp_systems(id),    -- ERP context used for exact-code matching
  valid_from date,
  valid_to date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','extracting','in_review','approved','published','rejected','expired')),
  document_id uuid REFERENCES documents(id),
  version int NOT NULL DEFAULT 1,
  created_by uuid,
  approved_by uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE TABLE contract_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  node_id uuid NOT NULL REFERENCES org_nodes(id),
  UNIQUE (contract_id, node_id)
);
CREATE TABLE extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  document_id uuid REFERENCES documents(id),
  provider text NOT NULL,
  provider_version text NOT NULL,
  prompt_version text,
  status text NOT NULL CHECK (status IN ('succeeded','failed','unsupported')),
  stats jsonb NOT NULL DEFAULT '{}',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE contract_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  extraction_run_id uuid REFERENCES extraction_runs(id),
  line_no int NOT NULL,
  raw jsonb NOT NULL,                       -- original extracted values, untouched
  source_ref text NOT NULL,                 -- "sheet/row" or "page"
  description text,
  supplier_item_code text,
  mpn text,
  brand text,
  material_code text,
  uom text,
  base_price numeric(18,4),
  discount_pct numeric(7,4) DEFAULT 0,
  net_price numeric(18,4),
  moq numeric(18,4),
  qty_cap numeric(18,4),
  currency text DEFAULT 'INR',
  extraction_confidence numeric(4,3),
  extraction_version text,
  status text NOT NULL DEFAULT 'extracted'
    CHECK (status IN ('extracted','needs_review','approved','rejected','published')),
  item_id uuid REFERENCES catalogue_items(id),      -- set only by an approved human decision
  UNIQUE (contract_id, line_no)
);
CREATE TABLE match_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_line_id uuid NOT NULL REFERENCES contract_lines(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  basis text NOT NULL CHECK (basis IN ('exact_code','supplier_code_or_mpn_brand','equivalent_code','spec_match','description_similarity')),
  confidence numeric(4,3) NOT NULL,
  suggested_by text NOT NULL DEFAULT 'rule' CHECK (suggested_by IN ('rule','ai')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_line_id, item_id, basis)
);

-- ───────── commercial configuration ─────────
CREATE TABLE model_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope_node_id uuid NOT NULL REFERENCES org_nodes(id),
  category text,                                     -- NULL = all categories
  model smallint NOT NULL CHECK (model IN (1,2,3)),
  valid_from date,
  valid_to date,
  approved_by_customer text,
  approved_by_procmart text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- BR-MOD-01: an entry only goes live with both approvals recorded.
  CHECK (status <> 'active' OR (approved_by_customer IS NOT NULL AND approved_by_procmart IS NOT NULL))
);

-- ───────── buying ─────────
CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  plant_node_id uuid NOT NULL REFERENCES org_nodes(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cart_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cart_id uuid NOT NULL REFERENCES carts(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  qty numeric(18,4) NOT NULL CHECK (qty > 0),
  uom text NOT NULL,
  need_by date,
  UNIQUE (cart_id, item_id)
);
CREATE SEQUENCE requirement_seq;
CREATE TABLE requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text NOT NULL,
  plant_node_id uuid NOT NULL REFERENCES org_nodes(id),
  requester_id uuid NOT NULL REFERENCES users(id),
  cart_id uuid REFERENCES carts(id),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','routed','returned','in_progress','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE TABLE streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  plant_node_id uuid NOT NULL REFERENCES org_nodes(id),
  model smallint NOT NULL CHECK (model IN (1,2,3)),
  supplier_id uuid REFERENCES suppliers(id),
  status text NOT NULL DEFAULT 'routed'
    CHECK (status IN ('routed','pr_requested','pr_created','pr_failed','po_released','acknowledged','dispatched','delivered','grn_posted','invoiced','paid','closed')),
  pr_reference text,
  po_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE requirement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requirement_id uuid NOT NULL REFERENCES requirements(id),
  line_no int NOT NULL,
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  qty numeric(18,4) NOT NULL,
  uom text NOT NULL,
  need_by date,
  route text NOT NULL CHECK (route IN ('arc','award','direct','sourcing','returned','exception')),
  model smallint CHECK (model IN (1,2,3)),
  fee_treatment text CHECK (fee_treatment IN ('none','supplier_enablement','management_fee')),
  contract_line_id uuid REFERENCES contract_lines(id),
  supplier_id uuid REFERENCES suppliers(id),
  stream_id uuid REFERENCES streams(id),
  unit_price numeric(18,4),
  routing_trace jsonb NOT NULL DEFAULT '[]',
  UNIQUE (requirement_id, line_no),
  -- BR-FEE-01: exactly one fee treatment, and it must agree with the model.
  CHECK ((model IS NULL AND fee_treatment IS NULL)
      OR (model = 1 AND fee_treatment = 'none')
      OR (model = 2 AND fee_treatment = 'supplier_enablement')
      OR (model = 3 AND fee_treatment = 'management_fee'))
);
CREATE TABLE order_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requirement_id uuid REFERENCES requirements(id),
  stream_id uuid REFERENCES streams(id),
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  simulated boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL DEFAULT now()
);

-- ───────── integration & jobs ─────────
CREATE TABLE erp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  stream_id uuid REFERENCES streams(id),
  adapter text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request jsonb NOT NULL,
  response jsonb,
  simulated boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('sent','ok','error')),
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, adapter, operation, idempotency_key)
);
CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, idempotency_key)
);
CREATE INDEX outbox_due ON outbox(next_run_at) WHERE status = 'pending';

-- ───────── row-level security ─────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_policies','erp_systems','org_level_types','org_nodes','users','roles','user_roles','audit_log',
    'suppliers','supplier_erp_codes','catalogue_items','catalogue_item_versions','item_erp_codes',
    'documents','contracts','contract_scopes','extraction_runs','contract_lines','match_candidates',
    'model_allocations','carts','cart_lines','requirements','streams','requirement_lines','order_events',
    'erp_messages','outbox']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (current_setting('app.platform', true) = 'on');
