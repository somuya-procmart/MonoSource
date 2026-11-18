import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PoolClient } from 'pg';
import { Db } from '../db/db';
import { audit, canAtNode, CurrentCtx, Ctx, Perm } from '../common/security';
import { ackDecision, canMove, deriveStatus, LineQty, QTY_OPEN, validateDispatch, validateGrn } from './orders';
import { QuoteLineDto, recordQuote } from './sourcing.controller';

class AckLine { @IsUUID() lineId: string; @IsNumber() @Min(0) qty: number; @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string; @IsOptional() @IsString() note?: string }
class AckDto { @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AckLine) lines: AckLine[] }
class DispLine { @IsUUID() lineId: string; @IsNumber() @IsPositive() qty: number }
class DispatchDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DispLine) lines: DispLine[];
  @IsOptional() @IsString() invoiceNumber?: string; @IsOptional() @IsString() ewayBill?: string; @IsOptional() @IsString() carrier?: string; @IsOptional() @IsString() trackingRef?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedDate?: string;
}
class InvoiceDto { @IsString() invoiceNumber: string; @IsNumber() @IsPositive() amount: number }
class PortalQuoteDto { @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines: QuoteLineDto[] }
class GrnLine { @IsUUID() lineId: string; @IsNumber() @Min(0) accepted: number; @IsNumber() @Min(0) rejected: number }
class GrnDto { @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => GrnLine) lines: GrnLine[] }

const isId = (s: string) => /^[0-9a-f-]{36}$/.test(s);
const VISIBLE = ['po_released', 'acknowledged', 'partially_dispatched', 'dispatched', 'delivered', 'partially_received', 'grn_posted', 'invoiced', 'paid', 'closed'];

/** Quantity picture per line of a stream. */
export async function lineQuantities(c: PoolClient, streamId: string): Promise<LineQty[]> {
  return (await c.query(
    `SELECT rl.id AS "lineId", rl.qty::float AS ordered, lc.qty_committed::float AS committed,
            coalesce((SELECT sum(sl.qty) FROM shipment_lines sl WHERE sl.requirement_line_id=rl.id),0)::float AS dispatched,
            coalesce((SELECT sum(g.qty_accepted) FROM grn_receipts g WHERE g.requirement_line_id=rl.id),0)::float AS received,
            coalesce((SELECT sum(g.qty_rejected) FROM grn_receipts g WHERE g.requirement_line_id=rl.id),0)::float AS rejected
       FROM requirement_lines rl LEFT JOIN line_commitments lc ON lc.requirement_line_id=rl.id WHERE rl.stream_id=$1 ORDER BY rl.line_no`, [streamId])).rows;
}
async function raise(c: PoolClient, ctx: { tenantId: string }, kind: string, st: any, detail: string) {
  await c.query(`INSERT INTO exceptions(tenant_id,kind,requirement_id,stream_id,detail) VALUES ($1,$2,$3,$4,$5)`, [ctx.tenantId, kind, st.requirement_id, st.id, detail]);
}
async function setStatus(c: PoolClient, ctx: { tenantId: string }, st: any, status: string, kind: string, detail: any = {}, simulated = false) {
  if (st.status !== status) await c.query(`UPDATE streams SET status=$2 WHERE id=$1`, [st.id, status]);
  await c.query(`INSERT INTO order_events(tenant_id,requirement_id,stream_id,kind,detail,simulated) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.tenantId, st.requirement_id, st.id, kind, JSON.stringify(detail), simulated]);
}

function requireSupplier(ctx: Ctx): string {
  if (ctx.kind !== 'supplier' || !ctx.supplierId) throw new ForbiddenException('Supplier users only');
  return ctx.supplierId;
}

@Controller()
export class OrdersController {
  constructor(private db: Db) {}

  // ───────── supplier portal ─────────
  @Perm('supplier-portal:use')
  @Get('portal/orders')
  portalOrders(@CurrentCtx() ctx: Ctx) {
    const sid = requireSupplier(ctx);
    return this.db.tx(ctx, async (c) => (await c.query(
      `SELECT st.id, st.status, st.po_reference AS "poReference", r.number AS requirement, n.name AS plant, st.status_at AS "statusAt",
              (SELECT count(*) FROM requirement_lines WHERE stream_id=st.id) AS lines
         FROM streams st JOIN requirements r ON r.id=st.requirement_id JOIN org_nodes n ON n.id=st.plant_node_id
        WHERE st.supplier_id=$1 AND st.status = ANY($2) ORDER BY st.status_at DESC`, [sid, VISIBLE])).rows);
  }

  /** The supplier sees only its own order: no fee treatment, no commercial model, no other suppliers. */
  @Perm('supplier-portal:use')
  @Get('portal/orders/:id')
  portalOrder(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const sid = requireSupplier(ctx);
    return this.db.tx(ctx, async (c) => {
      const st = await this.ownStream(c, id, sid);
      const q = await lineQuantities(c, id);
      const lines = (await c.query(`SELECT rl.id, rl.line_no AS "lineNo", i.name AS item, rl.uom, rl.unit_price AS "unitPrice", rl.need_by AS "needBy" FROM requirement_lines rl JOIN catalogue_items i ON i.id=rl.item_id WHERE rl.stream_id=$1 ORDER BY rl.line_no`, [id])).rows
        .map((l) => ({ ...l, ...q.find((x) => x.lineId === l.id) }));
      const shipments = (await c.query(`SELECT asn_number AS "asn", carrier, tracking_ref AS "trackingRef", expected_date AS "expectedDate", at FROM shipments WHERE stream_id=$1 ORDER BY at`, [id])).rows;
      const invoices = (await c.query(`SELECT invoice_number AS "invoiceNumber", amount, status FROM invoices WHERE stream_id=$1`, [id])).rows;
      const n = (await c.query(`SELECT n.name FROM org_nodes n WHERE n.id=$1`, [st.plant_node_id])).rows[0];
      return { id: st.id, status: st.status, poReference: st.po_reference, deliverTo: n.name, lines, shipments, invoices };
    });
  }

  @Perm('supplier-portal:use')
  @Post('portal/orders/:id/acknowledge')
  acknowledge(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: AckDto) {
    const sid = requireSupplier(ctx);
    return this.db.tx(ctx, async (c) => {
      const st = await this.ownStream(c, id, sid, true);
      if (st.status !== 'po_released') throw new ConflictException(`Order is ${st.status}; it can only be acknowledged after the PO is released`);
      const qs = await lineQuantities(c, id);
      if (new Set(b.lines.map((l) => l.lineId)).size !== qs.length || b.lines.length !== qs.length) throw new BadRequestException('Acknowledge every line of the order');
      const dec: { ordered: number; committed: number }[] = [];
      for (const l of b.lines) {
        const q = qs.find((x) => x.lineId === l.lineId);
        if (!q) throw new BadRequestException('Line is not part of this order');
        if (l.qty > q.ordered) throw new BadRequestException('You cannot commit more than was ordered');
        dec.push({ ordered: q.ordered, committed: l.qty });
        await c.query(`INSERT INTO line_commitments(tenant_id,requirement_line_id,qty_committed,committed_date,note,by_user) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (requirement_line_id) DO UPDATE SET qty_committed=EXCLUDED.qty_committed, committed_date=EXCLUDED.committed_date, note=EXCLUDED.note, by_user=EXCLUDED.by_user, at=now()`,
          [ctx.tenantId, l.lineId, l.qty, l.date ?? null, l.note ?? null, ctx.userId]);
      }
      const d = ackDecision(dec);
      if (d === 'rejected') {
        await setStatus(c, ctx, st, 'po_released', 'supplier_rejected', { note: 'Supplier committed nothing' });
        await raise(c, ctx, 'supplier_rejected', st, 'Supplier declined the whole order; decide on reallocation or cancellation (rules not yet agreed, Q11)');
      } else {
        await setStatus(c, ctx, st, 'acknowledged', 'acknowledged', { decision: d });
        if (d === 'partial') await raise(c, ctx, 'supplier_partial', st, 'Supplier can supply only part of the quantity; decide on cover for the remainder (rules not yet agreed, Q11)');
      }
      await audit(c, ctx, 'order.acknowledged', 'stream', id, { decision: d });
      return { decision: d, status: d === 'rejected' ? 'po_released' : 'acknowledged' };
    });
  }

  @Perm('supplier-portal:use')
  @Post('portal/orders/:id/dispatch')
  dispatch(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: DispatchDto) {
    const sid = requireSupplier(ctx);
    return this.db.tx(ctx, async (c) => {
      const st = await this.ownStream(c, id, sid, true);
      if (!QTY_OPEN.includes(st.status)) throw new ConflictException(`Order is ${st.status}; acknowledge it before dispatching`);
      const qs = await lineQuantities(c, id);
      if (qs.some((q) => q.committed === null)) throw new ConflictException('Acknowledge the order before dispatching');
      const errs = validateDispatch(qs, b.lines.map((l) => ({ lineId: l.lineId, qty: l.qty })));
      if (errs.length) throw new BadRequestException(errs.join('; '));
      const asn = `ASN-${String((await c.query(`SELECT nextval('asn_seq') AS n`)).rows[0].n).padStart(6, '0')}`;
      const sh = (await c.query(`INSERT INTO shipments(tenant_id,stream_id,asn_number,invoice_number,eway_bill,carrier,tracking_ref,expected_date,by_user) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.tenantId, id, asn, b.invoiceNumber ?? null, b.ewayBill ?? null, b.carrier ?? null, b.trackingRef ?? null, b.expectedDate ?? null, ctx.userId])).rows[0];
      for (const l of b.lines) await c.query(`INSERT INTO shipment_lines(tenant_id,shipment_id,requirement_line_id,qty) VALUES ($1,$2,$3,$4)`, [ctx.tenantId, sh.id, l.lineId, l.qty]);
      const after = deriveStatus(await lineQuantities(c, id));
      await setStatus(c, ctx, st, after, 'dispatched', { asn, partial: after !== 'dispatched' });
      await audit(c, ctx, 'order.dispatched', 'stream', id, { asn, lines: b.lines });
      return { asn, status: after };
    });
  }

  @Perm('supplier-portal:use')
  @Post('portal/orders/:id/invoice')
  invoice(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: InvoiceDto) {
    const sid = requireSupplier(ctx);
    return this.db.tx(ctx, async (c) => {
      const st = await this.ownStream(c, id, sid, true);
      if (st.status !== 'grn_posted') throw new ConflictException(`Order is ${st.status}; an invoice can be submitted once goods are fully received (GRN)`);
      try { await c.query(`INSERT INTO invoices(tenant_id,stream_id,invoice_number,amount,by_user) VALUES ($1,$2,$3,$4,$5)`, [ctx.tenantId, id, b.invoiceNumber, b.amount, ctx.userId]); }
      catch (e: any) { if (e.code === '23505') throw new ConflictException('Invoice number already submitted'); throw e; }
      await setStatus(c, ctx, st, 'invoiced', 'invoiced', { invoiceNumber: b.invoiceNumber });
      await audit(c, ctx, 'order.invoiced', 'stream', id, { invoiceNumber: b.invoiceNumber, amount: b.amount });
      return { status: 'invoiced' };
    });
  }

  @Perm('supplier-portal:use')
  @Get('portal/rfqs')
  portalRfqs(@CurrentCtx() ctx: Ctx) {
    const sid = requireSupplier(ctx);
    return this.db.tx(ctx, async (c) => (await c.query(
      `SELECT f.id, f.number, f.closes_at AS "closesAt",
              EXISTS (SELECT 1 FROM quotes q WHERE q.rfq_id=f.id AND q.supplier_id=$1) AS quoted,
              (SELECT coalesce(json_agg(json_build_object('id', rl.id, 'item', i.name, 'qty', rl.qty, 'uom', rl.uom)), '[]') FROM rfq_lines rl JOIN catalogue_items i ON i.id=rl.item_id WHERE rl.rfq_id=f.id) AS lines
         FROM rfqs f JOIN rfq_invitations v ON v.rfq_id=f.id AND v.supplier_id=$1 WHERE f.status='open' ORDER BY f.created_at DESC`, [sid])).rows); // never shows other suppliers or their prices
  }

  @Perm('supplier-portal:use')
  @Post('portal/rfqs/:id/quote')
  portalQuote(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: PortalQuoteDto) {
    const sid = requireSupplier(ctx);
    return this.db.tx(ctx, async (c) => {
      if (!isId(id)) throw new NotFoundException();
      const rfq = (await c.query(`SELECT f.* FROM rfqs f JOIN rfq_invitations v ON v.rfq_id=f.id AND v.supplier_id=$2 WHERE f.id=$1 FOR UPDATE OF f`, [id, sid])).rows[0];
      if (!rfq) throw new NotFoundException();
      return recordQuote(c, ctx, rfq, sid, b.lines);
    });
  }

  // ───────── ERP-owned events (SIMULATED until a real feed exists) ─────────
  @Perm('integration:simulate')
  @Post('streams/:id/grn')
  grn(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: GrnDto) {
    return this.db.tx(ctx, async (c) => {
      const st = await this.staffStream(c, ctx, id);
      if (!QTY_OPEN.includes(st.status)) throw new ConflictException(`Stream is ${st.status}; goods can be received once the supplier has dispatched`);
      const qs = await lineQuantities(c, id);
      const errs = validateGrn(qs, b.lines);
      if (errs.length) throw new BadRequestException(errs.join('; '));
      const no = `SIM-GRN-${Date.now().toString().slice(-7)}`;
      for (const g of b.lines) {
        await c.query(`INSERT INTO grn_receipts(tenant_id,stream_id,requirement_line_id,qty_accepted,qty_rejected,grn_number,by_user) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ctx.tenantId, id, g.lineId, g.accepted, g.rejected, no, ctx.userId]);
        if (g.rejected > 0) await raise(c, ctx, 'quality_rejection', st, `${g.rejected} unit(s) rejected at GRN; replacement/return rules are not yet agreed (Q11)`);
      }
      const after = deriveStatus(await lineQuantities(c, id));
      await setStatus(c, ctx, st, after, after === 'grn_posted' ? 'grn_posted' : 'grn_partial', { grn: no }, true);
      await audit(c, ctx, 'simulated.grn', 'stream', id, { grn: no, lines: b.lines });
      return { grn: no, status: after, simulated: true };
    });
  }

  private async ownStream(c: PoolClient, id: string, supplierId: string, lock = false) {
    if (!isId(id)) throw new NotFoundException();
    const st = (await c.query(`SELECT * FROM streams WHERE id=$1 AND supplier_id=$2 AND status = ANY($3) ${lock ? 'FOR UPDATE' : ''}`, [id, supplierId, VISIBLE])).rows[0];
    if (!st) throw new NotFoundException(); // someone else's order looks the same as a missing one
    return st;
  }
  private async staffStream(c: PoolClient, ctx: Ctx, id: string) {
    if (!isId(id)) throw new NotFoundException();
    const st = (await c.query(`SELECT * FROM streams WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!st || !(await canAtNode(c, ctx, 'integration:simulate', st.plant_node_id))) throw new NotFoundException();
    return st;
  }
}
export { canMove };
