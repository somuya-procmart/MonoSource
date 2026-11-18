-- Phase 2/3 gaps: equivalent codes (match ladder step 3), item images/documents, guided-buying attribute templates.
CREATE TABLE material_equivalents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  erp_system_id uuid NOT NULL REFERENCES erp_systems(id),
  material_code text NOT NULL,                 -- a customer code that MDM treats as the same item
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, erp_system_id, material_code)
);
CREATE TABLE item_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  kind text NOT NULL CHECK (kind IN ('image','document')),
  filename text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  caption text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_assets_item ON item_assets(item_id);
-- Which attributes Ask MonoSource should ask for, per category, required ones first.
CREATE TABLE category_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  category text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  position int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, category, key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['material_equivalents','item_assets','category_attributes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
