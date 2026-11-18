import { PoolClient } from 'pg';
import { audit, Ctx } from '../common/security';
import { EXTRACTION_PROVIDERS } from '../ai/extraction';
import { matchLine, MatchItem } from './matching';

export async function loadItems(c: PoolClient): Promise<MatchItem[]> {
  const r = await c.query(
    `SELECT i.id, i.brand, i.mpn, i.category, i.specs,
       coalesce(json_agg(json_build_object('erpSystemId', ic.erp_system_id, 'materialCode', ic.material_code)) FILTER (WHERE ic.id IS NOT NULL),'[]') AS "erpCodes"
     FROM catalogue_items i LEFT JOIN item_erp_codes ic ON i.id=ic.item_id WHERE i.status='active' GROUP BY i.id`);
  return r.rows;
}

export type IngestOutcome =
  | { status: 'in_review'; lines: number; candidates: number; header?: any; notes?: string[] }
  | { status: 'draft'; extraction: 'unsupported' | 'failed'; error: string };

function unsupportedMessage(filename: string): string {
  if (/\.pdf$/i.test(filename)) return 'PDF extraction needs an AI provider, which is not configured (set ANTHROPIC_API_KEY). The file is stored; re-run extraction after configuring it.';
  return 'No extraction provider supports this file type. Use CSV or XLSX.';
}

/**
 * Reads a stored contract document, records an extraction run, stores normalised lines and queues suggested mappings.
 * Nothing here activates a line: every line lands in `needs_review`. Failures keep the contract as a draft so it can be retried.
 */
export async function ingestDocument(
  c: PoolClient, ctx: Ctx, contract: { id: string; erp_system_id: string | null }, doc: { id: string },
  file: { buffer: Buffer; originalname: string; mimetype: string },
): Promise<IngestOutcome> {
  const provider = EXTRACTION_PROVIDERS.find((p) => p.supports(file.mimetype, file.originalname));
  const fail = async (status: 'unsupported' | 'failed', provName: string, provVer: string, error: string): Promise<IngestOutcome> => {
    await c.query(`INSERT INTO extraction_runs(tenant_id,contract_id,document_id,provider,provider_version,status,error) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ctx.tenantId, contract.id, doc.id, provName, provVer, status, error.slice(0, 500)]);
    await c.query(`UPDATE contracts SET status='draft' WHERE id=$1`, [contract.id]);
    await audit(c, ctx, 'contract.extraction_' + status, 'contract', contract.id, { file: file.originalname, error: error.slice(0, 200) });
    return { status: 'draft', extraction: status, error };
  };
  if (!provider) return fail('unsupported', 'none', '-', unsupportedMessage(file.originalname));
  let result;
  try { result = await provider.extract(file.buffer, file.originalname); }
  catch (e: any) { return fail('failed', provider.name, provider.version, e.message ?? 'extraction failed'); }

  const run = (await c.query(
    `INSERT INTO extraction_runs(tenant_id,contract_id,document_id,provider,provider_version,prompt_version,status,stats) VALUES ($1,$2,$3,$4,$5,$6,'succeeded',$7) RETURNING id`,
    [ctx.tenantId, contract.id, doc.id, result.provider, result.providerVersion, result.promptVersion, JSON.stringify({ lines: result.lines.length, header: result.header ?? null, notes: result.notes ?? [] })])).rows[0];
  const items = await loadItems(c);
  const equivalents = (await c.query(`SELECT erp_system_id AS "erpSystemId", material_code AS "materialCode", item_id AS "itemId" FROM material_equivalents`)).rows;
  const base = (await c.query(`SELECT coalesce(max(line_no),0)::int AS n FROM contract_lines WHERE contract_id=$1`, [contract.id])).rows[0].n;
  let candidates = 0;
  for (const [i, l] of result.lines.entries()) {
    const line = (await c.query(
      `INSERT INTO contract_lines(tenant_id,contract_id,extraction_run_id,line_no,raw,source_ref,description,supplier_item_code,mpn,brand,material_code,uom,base_price,discount_pct,net_price,moq,qty_cap,extraction_confidence,extraction_version,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'needs_review') RETURNING id`,
      [ctx.tenantId, contract.id, run.id, base + i + 1, JSON.stringify({ ...l.raw, _issues: l.issues }), l.sourceRef, l.description ?? null, l.supplierItemCode ?? null, l.mpn ?? null, l.brand ?? null, l.materialCode ?? null, l.uom ?? null,
       l.basePrice ?? null, l.discountPct ?? 0, l.netPrice ?? null, l.moq ?? null, l.qtyCap ?? null, l.confidence, `${result.provider}@${result.providerVersion}`])).rows[0];
    const sim = l.description
      ? (await c.query(`SELECT id AS "itemId", similarity(name, $1) AS score FROM catalogue_items WHERE status='active' AND name % $1 ORDER BY score DESC LIMIT 5`, [l.description])).rows.map((r) => ({ itemId: r.itemId, score: +r.score }))
      : [];
    const cands = matchLine({ materialCode: l.materialCode, mpn: l.mpn, brand: l.brand }, contract.erp_system_id, items, sim, equivalents);
    for (const k of cands) {
      await c.query(`INSERT INTO match_candidates(tenant_id,contract_line_id,item_id,basis,confidence) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [ctx.tenantId, line.id, k.itemId, k.basis, k.confidence]);
      candidates++;
    }
  }
  await c.query(`UPDATE contracts SET status='in_review' WHERE id=$1`, [contract.id]);
  await audit(c, ctx, 'contract.extracted', 'contract', contract.id, { lines: result.lines.length, candidates, provider: result.provider });
  return { status: 'in_review', lines: result.lines.length, candidates, header: result.header, notes: result.notes };
}
