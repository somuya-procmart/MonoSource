import { BadRequestException, Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PoolClient } from 'pg';
import { Db } from '../db/db';
import { audit, CurrentCtx, Ctx, hasPerm, Perm, visibleNodeIds } from '../common/security';
import { METRICS, pct } from './metrics';

const isId = (s?: string) => !!s && /^[0-9a-f-]{36}$/.test(s);
const isDate = (s?: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Plants the caller may see (analytics:read scope), optionally narrowed to the subtree of one node. null = unrestricted. */
async function scope(c: PoolClient, ctx: Ctx, nodeId?: string): Promise<string[] | null> {
  const vis = await visibleNodeIds(c, ctx, 'analytics:read');
  if (!nodeId) return vis;
  if (!isId(nodeId)) throw new BadRequestException('bad nodeId');
  const sub = (await c.query(`WITH RECURSIVE d AS (SELECT id FROM org_nodes WHERE id=$1 UNION ALL SELECT n.id FROM org_nodes n JOIN d ON n.parent_id=d.id) SELECT id FROM d`, [nodeId])).rows.map((r) => r.id as string);
  if (!sub.length) throw new NotFoundException();
  return vis === null ? sub : sub.filter((x) => vis.includes(x));
}
function range(from?: string, to?: string) {
  if (!isDate(from) || !isDate(to)) throw new BadRequestException('Dates must be YYYY-MM-DD');
  const f = from ?? new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const t = to ?? new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  return { from: f, to: t };
}
/** One row per requirement line in scope and period. Every dashboard figure is computed from this set, so it can be drilled to records. */
const L = `SELECT rl.*, r.number AS req_number, r.plant_node_id, r.created_at AS req_at, i.category, i.name AS item_name, n.name AS plant_name
  FROM requirement_lines rl JOIN requirements r ON r.id=rl.requirement_id JOIN catalogue_items i ON i.id=rl.item_id JOIN org_nodes n ON n.id=r.plant_node_id
  WHERE r.created_at >= $2::date AND r.created_at < $3::date AND ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1))`;
const SUPPLIED = `route IN ('arc','direct','award') AND unit_price IS NOT NULL`;

@Controller('analytics')
export class AnalyticsController {
  constructor(private db: Db) {}

  @Perm('analytics:read')
  @Get('metrics')
  definitions() { return METRICS; }

  @Perm('analytics:read')
  @Get('overview')
  overview(@CurrentCtx() ctx: Ctx, @Query('nodeId') nodeId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const rg = range(from, to);
    return this.db.tx(ctx, async (c) => {
      const plants = await scope(c, ctx, nodeId);
      const P = [plants, rg.from, rg.to];
      const q = async (sql: string, extra: any[] = []) => (await c.query(sql, [...P, ...extra])).rows;

      const tot = (await q(`WITH l AS (${L}) SELECT count(DISTINCT requirement_id)::int AS requirements, count(*)::int AS lines,
          count(*) FILTER (WHERE route='arc')::int AS arc_lines,
          coalesce(sum(qty*unit_price) FILTER (WHERE ${SUPPLIED}),0)::float AS value,
          count(*) FILTER (WHERE route <> 'arc' AND routing_trace @> '[{"step":"arc-eligibility"}]')::int AS unused FROM l`))[0];
      const byRoute = await q(`WITH l AS (${L}) SELECT route, count(*)::int AS lines FROM l GROUP BY route ORDER BY 2 DESC`);
      const byModel = await q(`WITH l AS (${L}) SELECT model, count(*)::int AS lines, coalesce(sum(qty*unit_price) FILTER (WHERE ${SUPPLIED}),0)::float AS value FROM l WHERE model IS NOT NULL GROUP BY model ORDER BY model`);
      const unusedReasons = await q(`WITH l AS (${L}) SELECT regexp_replace(w, '[0-9.]+', 'N', 'g') AS reason, count(*)::int AS lines
          FROM l, jsonb_array_elements(routing_trace) t, jsonb_array_elements_text(t->'detail'->'why') w WHERE l.route <> 'arc' AND t->>'step'='arc-eligibility' GROUP BY 1 ORDER BY 2 DESC`);

      const spread = (await q(`WITH l AS (${L}), a AS (
          SELECT rf.qty::float AS qty, qa.landed_unit_cost::float AS awarded, aw.is_l1,
                 (SELECT avg(x.landed_unit_cost)::float FROM quote_lines x WHERE x.rfq_line_id=aw.rfq_line_id AND x.uom=rf.uom) AS avg_all
            FROM awards aw JOIN rfq_lines rf ON rf.id=aw.rfq_line_id JOIN quote_lines qa ON qa.id=aw.quote_line_id JOIN l ON l.id=rf.requirement_line_id)
          SELECT coalesce(sum((avg_all-awarded)*qty),0)::float AS spread, count(*)::int AS awards, count(*) FILTER (WHERE NOT is_l1)::int AS non_l1 FROM a`))[0];

      const exceptionsByKind = await q(`SELECT e.kind, count(*)::int AS n, min(e.created_at) AS oldest FROM exceptions e JOIN requirements r ON r.id=e.requirement_id
          WHERE e.status='open' AND ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) AND r.created_at >= $2::date AND r.created_at < $3::date GROUP BY e.kind ORDER BY 2 DESC`);

      const pipeline = await q(`SELECT st.status, count(*)::int AS n FROM streams st JOIN requirements r ON r.id=st.requirement_id
          WHERE ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) AND r.created_at >= $2::date AND r.created_at < $3::date GROUP BY st.status ORDER BY 2 DESC`);
      const live = (await q(`SELECT
          count(*) FILTER (WHERE st.status IN ('dispatched','partially_dispatched','partially_received'))::int AS pending_grn,
          count(*) FILTER (WHERE st.status IN ('dispatched','partially_dispatched','partially_received') AND EXISTS (SELECT 1 FROM shipments sh WHERE sh.stream_id=st.id AND sh.expected_date < current_date))::int AS late
          FROM streams st JOIN requirements r ON r.id=st.requirement_id WHERE ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) AND r.created_at >= $2::date AND r.created_at < $3::date`))[0];

      const feeBase = await q(`WITH l AS (${L}) SELECT l.fee_treatment, coalesce(sum(g.qty_accepted*l.unit_price),0)::float AS value
          FROM l JOIN grn_receipts g ON g.requirement_line_id=l.id WHERE l.fee_treatment IS NOT NULL AND l.unit_price IS NOT NULL GROUP BY 1 ORDER BY 1`);

      // suppliers
      const sup = await q(`WITH l AS (${L}) SELECT s.id, s.legal_name AS name, count(DISTINCT st.id)::int AS orders,
            coalesce(sum(g.acc),0)::float AS accepted, coalesce(sum(g.rej),0)::float AS rejected,
            coalesce(sum(l.qty) FILTER (WHERE g.acc IS NOT NULL OR g.rej IS NOT NULL),0)::float AS ordered_with_grn
          FROM l JOIN streams st ON st.id=l.stream_id JOIN suppliers s ON s.id=st.supplier_id
          LEFT JOIN LATERAL (SELECT sum(qty_accepted) AS acc, sum(qty_rejected) AS rej FROM grn_receipts WHERE requirement_line_id=l.id HAVING count(*)>0) g ON true
          GROUP BY s.id, s.legal_name ORDER BY 3 DESC`);
      const ack = await q(`SELECT st.supplier_id, avg(extract(epoch FROM (a.at - p.at))/3600)::float AS hours, count(*)::int AS n
          FROM streams st JOIN requirements r ON r.id=st.requirement_id
          JOIN order_events p ON p.stream_id=st.id AND p.kind='po_released' JOIN order_events a ON a.stream_id=st.id AND a.kind='acknowledged'
          WHERE ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) AND r.created_at >= $2::date AND r.created_at < $3::date GROUP BY st.supplier_id`);
      const ont = await q(`WITH l AS (${L}) SELECT st.supplier_id, count(*)::int AS total, count(*) FILTER (WHERE sh.at::date <= lc.committed_date)::int AS ontime
          FROM l JOIN line_commitments lc ON lc.requirement_line_id=l.id JOIN shipment_lines sl ON sl.requirement_line_id=l.id JOIN shipments sh ON sh.id=sl.shipment_id JOIN streams st ON st.id=l.stream_id
          WHERE lc.committed_date IS NOT NULL GROUP BY st.supplier_id`);
      const unresp = await q(`SELECT st.supplier_id, count(*)::int AS n FROM exceptions e JOIN streams st ON st.id=e.stream_id JOIN requirements r ON r.id=e.requirement_id
          WHERE e.kind='supplier_unresponsive' AND ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) AND r.created_at >= $2::date AND r.created_at < $3::date GROUP BY st.supplier_id`);
      const suppliers = sup.map((s) => {
        const a = ack.find((x) => x.supplier_id === s.id); const o = ont.find((x) => x.supplier_id === s.id); const u = unresp.find((x) => x.supplier_id === s.id);
        return { id: s.id, name: s.name, orders: s.orders, fillRate: pct(s.accepted, s.ordered_with_grn), rejectionRate: pct(s.rejected, s.accepted + s.rejected),
          ackHours: a ? +a.hours.toFixed(1) : null, onTimeDispatch: o ? pct(o.ontime, o.total) : null, unresponsive: u?.n ?? 0 };
      });
      const allAck = ack.length ? ack.reduce((s, x) => s + x.hours * x.n, 0) / ack.reduce((s, x) => s + x.n, 0) : null;
      const totAcc = sup.reduce((s, x) => s + x.accepted, 0), totRej = sup.reduce((s, x) => s + x.rejected, 0), totOrd = sup.reduce((s, x) => s + x.ordered_with_grn, 0);
      const totOnt = ont.reduce((s, x) => s + x.total, 0), totOntOk = ont.reduce((s, x) => s + x.ontime, 0);

      // plants and categories
      const plantsTbl = (await q(`WITH l AS (${L}) SELECT plant_node_id AS id, plant_name AS name, count(DISTINCT requirement_id)::int AS requirements, count(*)::int AS lines,
            count(*) FILTER (WHERE route='arc')::int AS arc, coalesce(sum(qty*unit_price) FILTER (WHERE ${SUPPLIED}),0)::float AS value FROM l GROUP BY 1,2 ORDER BY 6 DESC`));
      const openByPlant = await q(`SELECT r.plant_node_id AS id, count(*)::int AS n FROM exceptions e JOIN requirements r ON r.id=e.requirement_id WHERE e.status='open' AND ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) AND r.created_at >= $2::date AND r.created_at < $3::date GROUP BY 1`);
      const plantsOut = plantsTbl.map((p) => ({ ...p, coverage: pct(p.arc, p.lines), openExceptions: openByPlant.find((x) => x.id === p.id)?.n ?? 0 }));
      const cats = (await q(`WITH l AS (${L}) SELECT coalesce(category,'Uncategorised') AS category, count(*)::int AS lines, count(*) FILTER (WHERE route='arc')::int AS arc,
            coalesce(sum(qty*unit_price) FILTER (WHERE ${SUPPLIED}),0)::float AS value FROM l GROUP BY 1 ORDER BY 4 DESC`)).map((x) => ({ ...x, coverage: pct(x.arc, x.lines) }));

      // contracts (needs contracts:read: it exposes supplier prices/caps)
      let utilisation: any[] | null = null, expiring: any[] | null = null;
      if (hasPerm(ctx, 'contracts:read')) {
        utilisation = (await q(`WITH u AS (SELECT cl.id, cl.contract_id, cl.item_id, cl.qty_cap::float AS cap, coalesce((SELECT sum(rl.qty) FROM requirement_lines rl JOIN requirements r ON r.id=rl.requirement_id
              WHERE rl.contract_line_id=cl.id AND ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) AND r.created_at >= $2::date AND r.created_at < $3::date),0)::float AS used
              FROM contract_lines cl WHERE cl.status='published' AND cl.qty_cap IS NOT NULL)
            SELECT ct.number, s.legal_name AS supplier, i.name AS item, u.cap, u.used FROM u JOIN contracts ct ON ct.id=u.contract_id JOIN catalogue_items i ON i.id=u.item_id LEFT JOIN suppliers s ON s.id=ct.supplier_id ORDER BY u.used/NULLIF(u.cap,0) DESC NULLS LAST LIMIT 15`))
          .map((x) => ({ ...x, utilisation: pct(x.used, x.cap) }));
        expiring = (await c.query(`SELECT ct.id, ct.number, s.legal_name AS supplier, ct.valid_to AS "validTo", (ct.valid_to::date - current_date) AS days FROM contracts ct LEFT JOIN suppliers s ON s.id=ct.supplier_id
            WHERE ct.status='published' AND ct.valid_to <= current_date + 90 ORDER BY ct.valid_to LIMIT 20`)).rows;
      }

      return {
        meta: { from: rg.from, to: rg.to, nodeId: nodeId ?? null, generatedAt: new Date().toISOString(), scope: plants === null ? 'all plants' : `${plants.length} node(s)`,
          dataNote: 'Computed from MonoSource records only. SAP PO/GRN/invoice/payment are simulated until a live ERP feed exists.' },
        metrics: {
          requirements: tot.requirements, lines: tot.lines, committed_value: tot.value, contract_coverage: pct(tot.arc_lines, tot.lines), contract_candidate_unused: tot.unused,
          rfq_competition_spread: spread.spread, non_l1_awards: spread.non_l1, open_exceptions: exceptionsByKind.reduce((s, e) => s + e.n, 0),
          pending_grn_streams: live.pending_grn, late_deliveries: live.late, fee_base_value: feeBase.reduce((s, f) => s + f.value, 0),
          supplier_fill_rate: pct(totAcc, totOrd), supplier_rejection_rate: pct(totRej, totAcc + totRej), supplier_ack_hours: allAck === null ? null : +allAck.toFixed(1),
          supplier_ontime_dispatch: pct(totOntOk, totOnt),
        },
        breakdowns: { byRoute, byModel, unusedReasons, pipeline, exceptionsByKind, feeBase, suppliers, plants: plantsOut, categories: cats, utilisation, expiring },
      };
    });
  }

  /** The records behind a figure. */
  @Perm('analytics:read')
  @Get('drill')
  drill(@CurrentCtx() ctx: Ctx, @Query('kind') kind: string, @Query('nodeId') nodeId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const rg = range(from, to);
    return this.db.tx(ctx, async (c) => {
      const plants = await scope(c, ctx, nodeId); const P = [plants, rg.from, rg.to];
      const lineCols = `req_number AS requirement, plant_name AS plant, item_name AS item, qty, uom, route, model, fee_treatment AS "fee", unit_price AS "unitPrice", requirement_id AS "requirementId"`;
      const where: Record<string, string> = { lines: 'true', spend: SUPPLIED, coverage: 'true', off_contract: `route <> 'arc' AND routing_trace @> '[{"step":"arc-eligibility"}]'` };
      if (where[kind]) return { kind, rows: (await c.query(`WITH l AS (${L}) SELECT ${lineCols} FROM l WHERE ${where[kind]} ORDER BY req_at DESC LIMIT 300`, P)).rows };
      if (kind === 'awards') return { kind, rows: (await c.query(`WITH l AS (${L}) SELECT l.req_number AS requirement, l.item_name AS item, rf.qty, s.legal_name AS supplier, qa.landed_unit_cost AS "landedUnitCost", aw.is_l1 AS "isL1", aw.reason, l.requirement_id AS "requirementId"
          FROM awards aw JOIN rfq_lines rf ON rf.id=aw.rfq_line_id JOIN quote_lines qa ON qa.id=aw.quote_line_id JOIN quotes q ON q.id=qa.quote_id JOIN suppliers s ON s.id=q.supplier_id JOIN l ON l.id=rf.requirement_line_id ORDER BY aw.created_at DESC LIMIT 300`, P)).rows };
      if (kind === 'exceptions') return { kind, rows: (await c.query(`SELECT e.kind, e.detail, e.created_at AS "createdAt", r.number AS requirement, r.id AS "requirementId" FROM exceptions e JOIN requirements r ON r.id=e.requirement_id
          WHERE e.status='open' AND ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) AND r.created_at >= $2::date AND r.created_at < $3::date ORDER BY e.created_at LIMIT 300`, P)).rows };
      if (kind === 'pipeline') return { kind, rows: (await c.query(`SELECT r.number AS requirement, r.id AS "requirementId", n.name AS plant, s.legal_name AS supplier, st.status, st.po_reference AS "po",
          (SELECT max(expected_date) FROM shipments WHERE stream_id=st.id) AS "expectedDate" FROM streams st JOIN requirements r ON r.id=st.requirement_id JOIN org_nodes n ON n.id=r.plant_node_id JOIN suppliers s ON s.id=st.supplier_id
          WHERE st.status IN ('dispatched','partially_dispatched','partially_received') AND ($1::uuid[] IS NULL OR r.plant_node_id = ANY($1)) AND r.created_at >= $2::date AND r.created_at < $3::date ORDER BY st.status_at LIMIT 300`, P)).rows };
      throw new BadRequestException('Unknown drill kind');
    });
  }

  /** Operational MIS: one flat row per requirement line with its order status. CSV-injection safe. */
  @Perm('analytics:read')
  @Get('mis.csv')
  async mis(@CurrentCtx() ctx: Ctx, @Res() res: Response, @Query('nodeId') nodeId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const rg = range(from, to);
    const rows = await this.db.tx(ctx, async (c) => {
      const plants = await scope(c, ctx, nodeId);
      const r = (await c.query(`WITH l AS (${L}) SELECT l.req_number, l.req_at, l.plant_name, l.item_name, l.category, l.qty, l.uom, l.route, l.model, l.fee_treatment, l.unit_price,
          s.legal_name AS supplier, st.status AS order_status, st.pr_reference, st.po_reference, lc.qty_committed,
          coalesce((SELECT sum(qty) FROM shipment_lines WHERE requirement_line_id=l.id),0) AS dispatched,
          coalesce((SELECT sum(qty_accepted) FROM grn_receipts WHERE requirement_line_id=l.id),0) AS received,
          coalesce((SELECT sum(qty_rejected) FROM grn_receipts WHERE requirement_line_id=l.id),0) AS rejected
          FROM l LEFT JOIN streams st ON st.id=l.stream_id LEFT JOIN suppliers s ON s.id=l.supplier_id LEFT JOIN line_commitments lc ON lc.requirement_line_id=l.id ORDER BY l.req_at DESC, l.line_no`, [plants, rg.from, rg.to])).rows;
      await audit(c, ctx, 'analytics.mis_exported', 'analytics', undefined, { rows: r.length, from: rg.from, to: rg.to, nodeId: nodeId ?? null });
      return r;
    });
    const cols = ['req_number', 'req_at', 'plant_name', 'item_name', 'category', 'qty', 'uom', 'route', 'model', 'fee_treatment', 'unit_price', 'supplier', 'order_status', 'pr_reference', 'po_reference', 'qty_committed', 'dispatched', 'received', 'rejected'];
    const esc = (v: any) => { let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="monosource-mis.csv"'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send([cols.join(','), ...rows.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n'));
  }
}
