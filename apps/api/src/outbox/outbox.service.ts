import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db } from '../db/db';
import { audit } from '../common/security';
import { adapterFor, NonRetryableError } from '../integrations/erp-adapter';

/**
 * Durable job runner on a Postgres outbox (ADR-004).
 * A job is claimed by pushing its next_run_at 5 minutes out (a crashed worker's job reappears automatically),
 * then marked done or rescheduled with exponential backoff. Idempotency keys make re-runs safe.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('outbox');
  private timer?: NodeJS.Timeout;
  constructor(private db: Db) {}

  onModuleInit() {
    if (process.env.OUTBOX_WORKER === 'off') return;
    this.timer = setInterval(() => this.runOnce().catch((e) => this.log.error(e.message)), 1000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(limit = 10): Promise<number> {
    const jobs = await this.db.platformTx(async (c) =>
      (await c.query(
        `UPDATE outbox SET next_run_at = now() + interval '5 minutes', attempts = attempts + 1
          WHERE id IN (SELECT id FROM outbox WHERE status='pending' AND next_run_at <= now() ORDER BY next_run_at LIMIT $1 FOR UPDATE SKIP LOCKED)
          RETURNING id, tenant_id, kind, payload, attempts, max_attempts`, [limit])).rows);
    for (const j of jobs) {
      try {
        await this.handle(j);
        await this.db.tx({ tenantId: j.tenant_id }, (c) => c.query(`UPDATE outbox SET status='done', last_error=NULL WHERE id=$1`, [j.id]));
      } catch (e: any) {
        const dead = e instanceof NonRetryableError || j.attempts >= j.max_attempts;
        this.log.warn(`job ${j.kind} ${j.id} failed (attempt ${j.attempts}): ${e.message}`);
        await this.db.tx({ tenantId: j.tenant_id }, (c) =>
          c.query(`UPDATE outbox SET status=$2, last_error=$3, next_run_at = now() + ($4 || ' seconds')::interval WHERE id=$1`,
            [j.id, dead ? 'failed' : 'pending', String(e.message).slice(0, 500), String(Math.min(3600, 2 ** j.attempts * 5))]));
        if (dead && j.kind === 'erp.submit_pr')
          await this.db.tx({ tenantId: j.tenant_id }, async (c) => {
            await c.query(`UPDATE streams SET status='pr_failed' WHERE id=$1`, [j.payload.streamId]);
            await c.query(`INSERT INTO order_events(tenant_id,requirement_id,stream_id,kind,detail) SELECT tenant_id, requirement_id, id, 'pr_failed', $2 FROM streams WHERE id=$1`, [j.payload.streamId, JSON.stringify({ reason: e.message })]);
            await c.query(`INSERT INTO exceptions(tenant_id,kind,requirement_id,stream_id,detail) SELECT tenant_id, 'pr_failed', requirement_id, id, $2 FROM streams WHERE id=$1`, [j.payload.streamId, e.message]);
            await audit(c, { tenantId: j.tenant_id, userId: null }, 'pr.failed', 'stream', j.payload.streamId, { reason: e.message });
          });
      }
    }
    return jobs.length;
  }

  private async handle(j: { tenant_id: string; kind: string; payload: any }) {
    if (j.kind !== 'erp.submit_pr') throw new NonRetryableError(`Unknown job kind ${j.kind}`);
    await this.db.tx({ tenantId: j.tenant_id }, async (c) => {
      const st = (await c.query(`SELECT * FROM streams WHERE id=$1 FOR UPDATE`, [j.payload.streamId])).rows[0];
      if (!st) throw new NonRetryableError('stream missing');
      if (st.status === 'pr_created') return; // already done: idempotent re-run
      const plant = (await c.query(`SELECT n.code, n.erp_system_id, e.code AS server, e.kind, e.config FROM org_nodes n LEFT JOIN erp_systems e ON e.id=n.erp_system_id WHERE n.id=$1`, [st.plant_node_id])).rows[0];
      if (!plant?.erp_system_id) throw new NonRetryableError('Plant has no ERP system');
      // Supplier identity is per ERP: the PR needs THIS server's vendor code (BRD scenario 5). Never guess one.
      const vc = (await c.query(`SELECT vendor_code FROM supplier_erp_codes WHERE supplier_id=$1 AND erp_system_id=$2`, [st.supplier_id, plant.erp_system_id])).rows[0];
      if (!vc) throw new NonRetryableError(`Supplier has no vendor code on ERP ${plant.server}; a vendor-code extension request is needed`);
      const lines = (await c.query(
        `SELECT rl.qty, rl.uom, rl.need_by, rl.unit_price, ic.material_code, ct.number AS contract_number
           FROM requirement_lines rl
           LEFT JOIN item_erp_codes ic ON ic.item_id=rl.item_id AND ic.erp_system_id=$2
           LEFT JOIN contract_lines cl ON cl.id=rl.contract_line_id LEFT JOIN contracts ct ON ct.id=cl.contract_id
          WHERE rl.stream_id=$1 ORDER BY rl.line_no`, [st.id, plant.erp_system_id])).rows;
      const missing = lines.find((l) => !l.material_code);
      if (missing) throw new NonRetryableError(`An item has no material code on ERP ${plant.server}; map it before a PR can be sent`);

      const key = `pr:${st.id}`;
      const adapter = adapterFor(plant.kind);
      const req = { idempotencyKey: key, serverCode: plant.server, plantCode: plant.code, vendorCode: vc.vendor_code,
        lines: lines.map((l) => ({ materialCode: l.material_code, qty: +l.qty, uom: l.uom, unitPrice: l.unit_price === null ? null : +l.unit_price, needBy: l.need_by, contractRef: l.contract_number })) };
      const res = await adapter.submitPurchaseRequisition(req, plant.config);
      await c.query(
        `INSERT INTO erp_messages(tenant_id,stream_id,adapter,operation,idempotency_key,request,response,simulated,status) VALUES ($1,$2,$3,'submit_pr',$4,$5,$6,$7,'ok')
         ON CONFLICT (tenant_id,adapter,operation,idempotency_key) DO NOTHING`,
        [j.tenant_id, st.id, adapter.kind, key, JSON.stringify(req), JSON.stringify(res), res.simulated]);
      await c.query(`UPDATE streams SET status='pr_created', pr_reference=$2 WHERE id=$1`, [st.id, res.prNumber]);
      await c.query(`INSERT INTO order_events(tenant_id,requirement_id,stream_id,kind,detail,simulated) VALUES ($1,$2,$3,'pr_created',$4,$5)`,
        [j.tenant_id, st.requirement_id, st.id, JSON.stringify({ prNumber: res.prNumber }), res.simulated]);
      await c.query(`UPDATE requirements SET status='in_progress' WHERE id=$1 AND status IN ('submitted','routed')`, [st.requirement_id]);
      await audit(c, { tenantId: j.tenant_id, userId: null }, 'pr.created', 'stream', st.id, { prNumber: res.prNumber, simulated: res.simulated });
    });
  }
}
