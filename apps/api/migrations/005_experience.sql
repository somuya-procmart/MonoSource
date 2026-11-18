-- Experience redesign support: saved items, user-selected contract supply on cart lines.
CREATE TABLE saved_items (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  item_id uuid NOT NULL REFERENCES catalogue_items(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
ALTER TABLE cart_lines ADD COLUMN contract_line_id uuid REFERENCES contract_lines(id);  -- buyer's chosen supply (ARC/QRC line); NULL = let the rules decide
ALTER TABLE saved_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saved_items
  USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on');
