import { BadRequestException, Body, ConflictException, Controller, NotFoundException, Param, Post } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Db } from '../db/db';
import { audit, canAtNode, CurrentCtx, Ctx, Perm } from '../common/security';
import { canMove } from '../buying/orders';

class StepDto { @IsIn(['po_released', 'paid']) step: 'po_released' | 'paid'; }

/**
 * ⚠ SIMULATION ONLY. Stands in for events that happen in the customer's ERP: PO release and payment
 * (GRN has its own endpoint because it carries quantities). Supplier events (acknowledge, dispatch, invoice)
 * are NOT simulated: they go through the real supplier portal. Every row written here is stamped simulated=true.
 */
@Controller('streams')
export class SimulateController {
  constructor(private db: Db) {}

  @Perm('integration:simulate')
  @Post(':id/simulate')
  async step(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: StepDto) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const st = (await c.query(`SELECT * FROM streams WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!st) throw new NotFoundException();
      if (!(await canAtNode(c, ctx, 'integration:simulate', st.plant_node_id))) throw new NotFoundException();
      if (!canMove(st.status, b.step)) throw new ConflictException(`Stream is ${st.status}; "${b.step}" is not the next ERP step`);
      const po = b.step === 'po_released' ? `SIM-PO-${st.pr_reference?.replace('SIM-PR-', '') ?? id.slice(0, 7)}` : st.po_reference;
      await c.query(`UPDATE streams SET status=$2, po_reference=$3 WHERE id=$1`, [id, b.step, po]);
      if (b.step === 'paid') {
        if (!(await c.query(`UPDATE invoices SET status='paid' WHERE stream_id=$1`, [id])).rowCount) throw new BadRequestException('No invoice to pay');
        const open = await c.query(`SELECT 1 FROM streams WHERE requirement_id=$1 AND status<>'paid' AND id<>$2 AND status NOT IN ('pr_failed')`, [st.requirement_id, id]);
        const unrouted = await c.query(`SELECT 1 FROM requirement_lines WHERE requirement_id=$1 AND stream_id IS NULL AND route IN ('sourcing','exception')`, [st.requirement_id]);
        if (!open.rowCount && !unrouted.rowCount) await c.query(`UPDATE requirements SET status='closed' WHERE id=$1`, [st.requirement_id]);
      }
      await c.query(`INSERT INTO order_events(tenant_id,requirement_id,stream_id,kind,detail,simulated) VALUES ($1,$2,$3,$4,$5,true)`, [ctx.tenantId, st.requirement_id, id, b.step, JSON.stringify({ po })]);
      await audit(c, ctx, `simulated.${b.step}`, 'stream', id);
      return { status: b.step, po, simulated: true };
    });
  }
}
