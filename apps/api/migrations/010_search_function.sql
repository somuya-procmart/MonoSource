-- Search candidates without row-level-security scans.
-- Under RLS, Postgres will not use the GIN/trigram indexes for the app role: the match operators (@@, %, lower()=)
-- are not LEAKPROOF, so the tenant policy must be checked on every row first (a full scan: ~6 s on Supabase's
-- free tier, 0.3 s with the indexes). This function runs the indexed lookups as the owner and applies the
-- caller's tenant explicitly, read from the same setting the RLS policy uses. No tenant set → no rows.
CREATE OR REPLACE FUNCTION ms_search_candidates(
  node_ids uuid[], and_q text, or_q text, codes text[], use_or boolean, use_trgm boolean, q text, likes text[]
) RETURNS TABLE (id uuid, code_hit boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  qa tsquery := CASE WHEN and_q IS NULL THEN NULL ELSE to_tsquery('simple', and_q) END;
  qo tsquery := CASE WHEN or_q IS NULL THEN NULL ELSE to_tsquery('simple', or_q) END;
  qc tsquery := CASE WHEN cardinality(codes) > 0 THEN to_tsquery('simple', array_to_string(array(SELECT regexp_replace(c, '[^a-z0-9]', '', 'g') || ':*' FROM unnest(codes) c WHERE regexp_replace(c, '[^a-z0-9]', '', 'g') <> ''), ' | ')) END;
BEGIN
  IF t IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH cand AS (
    (SELECT x.id FROM catalogue_items x WHERE x.tenant_id = t AND x.status = 'active' AND x.product_type_id = ANY(node_ids)
      ORDER BY (CASE WHEN qo IS NULL THEN 0 ELSE ts_rank(x.search, qo) END) DESC, x.po_lines DESC LIMIT 600)
    UNION (SELECT x.id FROM catalogue_items x WHERE qa IS NOT NULL AND x.tenant_id = t AND x.search @@ qa ORDER BY x.po_lines DESC LIMIT 400)
    UNION (SELECT ic.item_id FROM item_erp_codes ic WHERE ic.tenant_id = t AND lower(ic.material_code) = ANY(codes))
    UNION (SELECT x.id FROM catalogue_items x WHERE x.tenant_id = t AND cardinality(codes) > 0 AND lower(x.mpn) = ANY(codes))
    UNION (SELECT x.id FROM catalogue_items x WHERE qc IS NOT NULL AND x.tenant_id = t AND x.search @@ qc LIMIT 200)
    UNION (SELECT x.id FROM catalogue_items x WHERE use_or AND qo IS NOT NULL AND x.tenant_id = t AND x.search @@ qo ORDER BY ts_rank(x.search, qo) DESC LIMIT 300)
    UNION (SELECT x.id FROM catalogue_items x WHERE use_trgm AND x.tenant_id = t AND x.name % q ORDER BY similarity(x.name, q) DESC LIMIT 40)
    UNION (SELECT a.item_id FROM item_aliases a WHERE a.tenant_id = t AND cardinality(likes) > 0 AND lower(a.value) LIKE ALL(likes) LIMIT 100)
    UNION (SELECT cl.item_id FROM contract_lines cl WHERE cl.tenant_id = t AND cl.item_id IS NOT NULL AND cl.status = 'published' AND cardinality(likes) > 0
             AND (lower(cl.description) LIKE ALL(likes) OR lower(cl.supplier_item_code) = lower(q)) LIMIT 100)
  )
  SELECT c.id, EXISTS (SELECT 1 FROM item_erp_codes ic WHERE ic.item_id = c.id AND ic.tenant_id = t AND lower(ic.material_code) = ANY(codes))
    FROM cand c WHERE c.id IS NOT NULL;
END $$;
CREATE INDEX IF NOT EXISTS item_erp_codes_lower ON item_erp_codes (tenant_id, lower(material_code));
REVOKE ALL ON FUNCTION ms_search_candidates(uuid[], text, text, text[], boolean, boolean, text, text[]) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monosource_app') THEN
    GRANT EXECUTE ON FUNCTION ms_search_candidates(uuid[], text, text, text[], boolean, boolean, text, text[]) TO monosource_app;
  END IF;
END $$;
