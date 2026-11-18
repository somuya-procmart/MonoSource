-- Agentic demo layer. EVERYTHING here is a deterministic simulation: no real agents, no real messages, no SAP transactions.
-- agentic_runs: where a requirement is in its (scripted) lifecycle. agent_events: the activity timeline.
-- human_tasks: things a person/team must decide. notifications: things that happened (never the same as tasks).
CREATE TABLE agentic_runs (
  requirement_id uuid PRIMARY KEY REFERENCES requirements(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL DEFAULT 'arc' CHECK (kind IN ('arc','sourcing')),
  step int NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'discovery' CHECK (stage IN ('discovery','coordination','evaluation','approval','fulfilment','complete')),
  context jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  offset_min int NOT NULL,                       -- simulated minutes since submission
  agent text NOT NULL CHECK (agent IN ('discovery','outreach','followup','quotation','comparison','coordination','human','supplier','system')),
  kind text NOT NULL,
  channel text CHECK (channel IN ('email','whatsapp','magic_link','phone','system','sap')),
  supplier_name text,
  title text NOT NULL,
  detail text,
  payload jsonb NOT NULL DEFAULT '{}',
  scheduled boolean NOT NULL DEFAULT false,      -- a planned future action (e.g. next follow-up)
  simulated boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_events_req ON agent_events(requirement_id, offset_min, id);
CREATE TABLE human_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('arc_applicability','technical_clarification','commercial_review','supplier_exception')),
  title text NOT NULL,
  reason text NOT NULL,
  owner_role text NOT NULL,
  required_perm text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting','done')),
  blocking boolean NOT NULL DEFAULT false,
  consequence text,
  related jsonb NOT NULL DEFAULT '{}',
  actions jsonb NOT NULL DEFAULT '[]',
  offset_min int NOT NULL DEFAULT 0,
  resolution jsonb,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX human_tasks_open ON human_tasks(tenant_id, status);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('milestone','human','supplier','delay','complete')),
  title text NOT NULL,
  body text,
  href text,
  requirement_id uuid REFERENCES requirements(id) ON DELETE CASCADE,
  simulated boolean NOT NULL DEFAULT true,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
CREATE TABLE notification_prefs (
  user_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  prefs jsonb NOT NULL DEFAULT '{}'
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agentic_runs','agent_events','human_tasks','notifications','notification_prefs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
