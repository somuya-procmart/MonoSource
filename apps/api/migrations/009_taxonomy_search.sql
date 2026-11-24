-- Product taxonomy (ProcMart category structure), semantic search on product types, real purchase-data fields.
-- Vectors live on the taxonomy (a few thousand rows), not on every item: a query is understood as product types first,
-- then items of those types are ranked lexically. Small enough for Supabase's free tier, and it keeps "electrical cables"
-- from returning MCBs just because both sit in category "Electrical".
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE taxonomy_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  parent_id uuid REFERENCES taxonomy_nodes(id),
  level text NOT NULL CHECK (level IN ('category','sub_category','child_category','product_type')),
  name text NOT NULL,
  path text NOT NULL,                     -- "Electrical > ELECTRICAL CABLE & ACCESSORIES > WIRES & CABLES > POWER CABLE"
  category text NOT NULL,                 -- top-level category name
  synonyms text[] NOT NULL DEFAULT '{}',  -- other names people use (abbreviations, SAP nouns)
  embedding vector(384),                  -- bge-small-en-v1.5 of name + parents + synonyms (see src/catalogue/embed.ts)
  item_count int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, path)
);
CREATE INDEX taxonomy_nodes_parent ON taxonomy_nodes(parent_id);
CREATE INDEX taxonomy_nodes_name_trgm ON taxonomy_nodes USING gin (lower(name) gin_trgm_ops);
CREATE INDEX taxonomy_nodes_embedding ON taxonomy_nodes USING hnsw (embedding vector_cosine_ops);

CREATE TABLE product_type_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_type_id uuid NOT NULL REFERENCES taxonomy_nodes(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  unit text,
  required boolean NOT NULL DEFAULT false,
  position int NOT NULL DEFAULT 0,
  UNIQUE (product_type_id, key)
);

ALTER TABLE catalogue_items
  ADD COLUMN product_type_id uuid REFERENCES taxonomy_nodes(id),
  ADD COLUMN classification jsonb NOT NULL DEFAULT '{}',   -- {basis: 'lexical'|'semantic'|'manual', confidence, matched}
  ADD COLUMN keywords text NOT NULL DEFAULT '',            -- normalised text: expanded SAP abbreviations + product type name
  ADD COLUMN spend_head text, ADD COLUMN spend_category text, ADD COLUMN capex_opex text,
  ADD COLUMN pricing_mechanism text, ADD COLUMN rrs_class text, ADD COLUMN material_group text,
  ADD COLUMN po_lines int NOT NULL DEFAULT 0,              -- purchase history, used to rank common items first
  ADD COLUMN plant_count int NOT NULL DEFAULT 0,
  ADD COLUMN last_po_date date,
  ADD COLUMN embedding vector(384);                        -- optional per-item vector (off by default; see DEPLOY.md)

-- The old search vector included the category name, so every "Electrical" item matched the word "electrical".
DROP INDEX catalogue_items_search;
ALTER TABLE catalogue_items DROP COLUMN search;
ALTER TABLE catalogue_items ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(name,'')), 'A') ||
  setweight(to_tsvector('simple', coalesce(brand,'') || ' ' || coalesce(mpn,'')), 'A') ||
  setweight(to_tsvector('simple', coalesce(keywords,'')), 'B') ||
  setweight(to_tsvector('simple', coalesce(description,'')), 'C')
) STORED;
CREATE INDEX catalogue_items_search ON catalogue_items USING gin(search);
CREATE INDEX catalogue_items_type ON catalogue_items(product_type_id) WHERE status = 'active';
CREATE INDEX catalogue_items_mpn ON catalogue_items (lower(mpn)) WHERE mpn IS NOT NULL;
CREATE INDEX catalogue_items_keywords_trgm ON catalogue_items USING gin (keywords gin_trgm_ops);
CREATE INDEX item_erp_codes_item ON item_erp_codes(item_id);
CREATE INDEX contract_lines_item ON contract_lines(item_id) WHERE status = 'published';

-- Real PO feeds have no price on every line (the files we import carry none).
ALTER TABLE po_history ALTER COLUMN unit_price DROP NOT NULL,
  ADD COLUMN po_item text, ADD COLUMN arc boolean NOT NULL DEFAULT false, ADD COLUMN valid_from date, ADD COLUMN valid_to date,
  ADD COLUMN pr_number text, ADD COLUMN spend_category text;
CREATE INDEX po_history_material ON po_history(material_code);
CREATE INDEX po_history_plant ON po_history(plant_node_id, po_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['taxonomy_nodes','product_type_attributes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
