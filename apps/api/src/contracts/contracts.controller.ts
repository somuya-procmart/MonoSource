import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Res, UnprocessableEntityException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { Response } from 'express';
import { PoolClient } from 'pg';
import { Db } from '../db/db';
import { audit, canAtNode, CurrentCtx, Ctx, Perm } from '../common/security';
import { Storage } from '../storage/storage';
import { ingestDocument } from './ingest';
import { validateForApproval } from './validation';

const MAX_UPLOAD = 20 * 1024 * 1024;
const ALLOWED_EXT = /\.(csv|xlsx|pdf)$/i;

class DecisionDto {
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject';
  @IsOptional() @IsString() reason?: string;
}
class HeaderDto {
  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() erpSystemId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validTo?: string;
}
class MapLineDto {
  @IsUUID() itemId: string;
  @IsString() reason: string;
}

@Controller()
export class ContractsController {
  constructor(private db: Db, private storage: Storage) {}

  /** Upload a contract document, extract its lines, and queue suggested mappings for human review. */
  @Perm('contracts:write')
  @Post('contracts')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  async upload(@CurrentCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File, @Body() b: Record<string, string>) {
    if (!file) throw new BadRequestException('file required');
    if (!ALLOWED_EXT.test(file.originalname)) throw new BadRequestException('Only .csv, .xlsx, .pdf accepted');
    if (!['ARC', 'QRC', 'PROCMART_DIRECT'].includes(b.contractType)) throw new BadRequestException('contractType must be ARC, QRC or PROCMART_DIRECT');
    const scopeNodeIds: string[] = b.scopeNodeIds ? String(b.scopeNodeIds).split(',').map((s) => s.trim()).filter(Boolean) : [];
    for (const k of [b.supplierId, b.erpSystemId, ...scopeNodeIds].filter(Boolean)) if (!/^[0-9a-f-]{36}$/.test(k)) throw new BadRequestException('Bad id in request');
    for (const d of [b.validFrom, b.validTo].filter(Boolean)) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException('Dates must be YYYY-MM-DD');

    const stored = this.storage.put(ctx.tenantId, file.buffer);
    return this.db.tx(ctx, async (c) => {
      for (const n of scopeNodeIds) {
        if (!(await c.query(`SELECT 1 FROM org_nodes WHERE id=$1`, [n])).rowCount) throw new BadRequestException('Unknown scope node');
        if (!(await canAtNode(c, ctx, 'contracts:write', n))) throw new BadRequestException('Scope node outside your authority');
      }
      if (b.supplierId && !(await c.query(`SELECT 1 FROM suppliers WHERE id=$1`, [b.supplierId])).rowCount) throw new BadRequestException('Unknown supplier');
      if (b.erpSystemId && !(await c.query(`SELECT 1 FROM erp_systems WHERE id=$1`, [b.erpSystemId])).rowCount) throw new BadRequestException('Unknown ERP system');

      const doc = (await c.query(
        `INSERT INTO documents(tenant_id,filename,mime,size_bytes,sha256,storage_key,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ctx.tenantId, file.originalname.slice(0, 200), file.mimetype, file.size, stored.sha256, stored.key, ctx.userId])).rows[0];
      const ct = (await c.query(
        `INSERT INTO contracts(tenant_id,contract_type,number,supplier_id,erp_system_id,valid_from,valid_to,document_id,created_by,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'extracting') RETURNING id`,
        [ctx.tenantId, b.contractType, b.number ?? null, b.supplierId ?? null, b.erpSystemId ?? null, b.validFrom ?? null, b.validTo ?? null, doc.id, ctx.userId])).rows[0];
      for (const n of scopeNodeIds) await c.query(`INSERT INTO contract_scopes(tenant_id,contract_id,node_id) VALUES ($1,$2,$3)`, [ctx.tenantId, ct.id, n]);

      const out = await ingestDocument(c, ctx, { id: ct.id, erp_system_id: b.erpSystemId ?? null }, doc, file);
      await audit(c, ctx, 'contract.uploaded', 'contract', ct.id, { file: file.originalname, outcome: out.status });
      return { id: ct.id, ...out };
    });
  }

  /** Re-run extraction on the stored original (for example after an AI provider has been configured). Only for a draft with no lines. */
  @Perm('contracts:write')
  @Post('contracts/:id/extract')
  reextract(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const ct = (await c.query(`SELECT * FROM contracts WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!ct) throw new NotFoundException();
      if (ct.status !== 'draft' || (await c.query(`SELECT 1 FROM contract_lines WHERE contract_id=$1`, [id])).rowCount) throw new ConflictException('Only a draft contract without lines can be re-extracted');
      const d = (await c.query(`SELECT * FROM documents WHERE id=$1`, [ct.document_id])).rows[0];
      if (!d) throw new NotFoundException('Original document missing');
      const out = await ingestDocument(c, ctx, ct, d, { buffer: this.storage.get(d.storage_key), originalname: d.filename, mimetype: d.mime });
      return { id, ...out };
    });
  }

  /** A person sets or confirms the contract header (including values an AI suggested). */
  @Perm('contracts:write')
  @Post('contracts/:id/header')
  setHeader(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: HeaderDto) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const ct = (await c.query(`SELECT * FROM contracts WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!ct) throw new NotFoundException();
      if (!['draft', 'in_review'].includes(ct.status)) throw new ConflictException('Header can only be changed while the contract is in draft or review');
      if (b.supplierId && !(await c.query(`SELECT 1 FROM suppliers WHERE id=$1`, [b.supplierId])).rowCount) throw new BadRequestException('Unknown supplier');
      if (b.erpSystemId && !(await c.query(`SELECT 1 FROM erp_systems WHERE id=$1`, [b.erpSystemId])).rowCount) throw new BadRequestException('Unknown ERP system');
      const vf = b.validFrom ?? ct.valid_from, vt = b.validTo ?? ct.valid_to;
      if (vf && vt && vt < vf) throw new BadRequestException('valid_to is before valid_from');
      await c.query(`UPDATE contracts SET number=coalesce($2,number), supplier_id=coalesce($3,supplier_id), erp_system_id=coalesce($4,erp_system_id), valid_from=$5, valid_to=$6 WHERE id=$1`,
        [id, b.number ?? null, b.supplierId ?? null, b.erpSystemId ?? null, vf, vt]);
      await audit(c, ctx, 'contract.header_set', 'contract', id, b);
      return { ok: true };
    });
  }

  @Perm('contracts:read')
  @Get('contracts')
  list(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(
      `SELECT ct.id, ct.contract_type AS type, ct.number, ct.status, ct.valid_from AS "validFrom", ct.valid_to AS "validTo", s.legal_name AS supplier,
              (SELECT count(*) FROM contract_lines WHERE contract_id=ct.id) AS lines,
              (SELECT CASE WHEN sum(cl.qty_cap) > 0 THEN round(100 * sum(coalesce((SELECT sum(rl.qty) FROM requirement_lines rl WHERE rl.contract_line_id = cl.id),0)) / sum(cl.qty_cap), 1) END
                 FROM contract_lines cl WHERE cl.contract_id=ct.id AND cl.status='published') AS utilisation,
              (SELECT coalesce(json_agg(n.name ORDER BY n.name),'[]') FROM contract_scopes cs JOIN org_nodes n ON n.id=cs.node_id WHERE cs.contract_id=ct.id) AS "appliesTo"
         FROM contracts ct LEFT JOIN suppliers s ON s.id=ct.supplier_id ORDER BY ct.valid_to DESC NULLS LAST, ct.created_at DESC`)).rows);
  }

  @Perm('contracts:read')
  @Get('contracts/:id')
  async one(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const h = (await c.query(`SELECT ct.*, s.legal_name AS supplier_name, d.filename FROM contracts ct LEFT JOIN suppliers s ON s.id=ct.supplier_id LEFT JOIN documents d ON d.id=ct.document_id WHERE ct.id=$1`, [id])).rows[0];
      if (!h) throw new NotFoundException();
      const lines = (await c.query(
        `SELECT cl.*, coalesce((SELECT json_agg(json_build_object('id', mc.id, 'itemId', mc.item_id, 'itemName', i.name, 'basis', mc.basis, 'confidence', mc.confidence, 'status', mc.status) ORDER BY mc.confidence DESC)
                                  FROM match_candidates mc JOIN catalogue_items i ON i.id=mc.item_id WHERE mc.contract_line_id=cl.id),'[]') AS candidates
           FROM contract_lines cl WHERE cl.contract_id=$1 ORDER BY line_no`, [id])).rows;
      const scopes = (await c.query(`SELECT n.id, n.name, n.level_type FROM contract_scopes cs JOIN org_nodes n ON n.id=cs.node_id WHERE cs.contract_id=$1`, [id])).rows;
      const runs = (await c.query(`SELECT provider, provider_version, prompt_version, status, stats, error, created_at FROM extraction_runs WHERE contract_id=$1 ORDER BY created_at`, [id])).rows;
      return { ...h, lines, scopes, extractionRuns: runs };
    });
  }

  @Perm('contracts:read')
  @Get('documents/:id')
  async download(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException();
    const d = await this.db.tx(ctx, async (c) => (await c.query(`SELECT filename, mime, storage_key FROM documents WHERE id=$1`, [id])).rows[0]);
    if (!d) throw new NotFoundException();
    res.setHeader('Content-Disposition', `attachment; filename="${d.filename.replace(/[^\w.\- ]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('application/octet-stream').send(this.storage.get(d.storage_key));
  }

  // ───────── human review ─────────
  @Perm('contracts:review')
  @Get('review/queue')
  queue(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => (await c.query(
      `SELECT cl.id AS "lineId", cl.contract_id AS "contractId", ct.number AS "contractNumber", cl.line_no AS "lineNo", cl.description, cl.material_code AS "materialCode",
              cl.mpn, cl.brand, cl.net_price AS "netPrice", cl.uom, cl.extraction_confidence AS confidence, cl.source_ref AS "sourceRef", cl.raw->'_issues' AS issues,
              coalesce((SELECT json_agg(json_build_object('id', mc.id, 'itemId', mc.item_id, 'itemName', i.name, 'basis', mc.basis, 'confidence', mc.confidence) ORDER BY mc.confidence DESC)
                          FROM match_candidates mc JOIN catalogue_items i ON i.id=mc.item_id WHERE mc.contract_line_id=cl.id AND mc.status='pending'),'[]') AS candidates
         FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id
        WHERE cl.status='needs_review' AND ct.status='in_review' ORDER BY ct.created_at, cl.line_no LIMIT 500`)).rows);
  }

  @Perm('contracts:review')
  @Post('review/candidates/:id/decision')
  async decide(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: DecisionDto) {
    return this.db.tx(ctx, async (c) => {
      const mc = (await c.query(`SELECT mc.*, ct.status AS contract_status FROM match_candidates mc JOIN contract_lines cl ON cl.id=mc.contract_line_id JOIN contracts ct ON ct.id=cl.contract_id WHERE mc.id=$1 FOR UPDATE OF mc`, [id])).rows[0];
      if (!mc) throw new NotFoundException();
      if (mc.status !== 'pending') throw new ConflictException('Already decided');
      if (mc.contract_status !== 'in_review') throw new ConflictException('Contract is not in review');
      if (b.decision === 'approve') {
        await c.query(`UPDATE match_candidates SET status='approved', decided_by=$2, decided_at=now(), decision_reason=$3 WHERE id=$1`, [id, ctx.userId, b.reason ?? null]);
        await c.query(`UPDATE match_candidates SET status='rejected', decided_by=$2, decided_at=now(), decision_reason='superseded by approved candidate' WHERE contract_line_id=$1 AND status='pending'`, [mc.contract_line_id, ctx.userId]);
        await c.query(`UPDATE contract_lines SET item_id=$2, status='approved' WHERE id=$1`, [mc.contract_line_id, mc.item_id]);
      } else {
        await c.query(`UPDATE match_candidates SET status='rejected', decided_by=$2, decided_at=now(), decision_reason=$3 WHERE id=$1`, [id, ctx.userId, b.reason ?? null]);
      }
      await audit(c, ctx, `mapping.${b.decision}`, 'match_candidate', id, { lineId: mc.contract_line_id, itemId: mc.item_id, basis: mc.basis, reason: b.reason });
      return { ok: true };
    });
  }

  /** Reviewer maps a line by hand when no suggestion is right. Needs a reason; fully audited. */
  @Perm('contracts:review')
  @Post('review/lines/:id/map')
  async mapLine(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: MapLineDto) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query(`SELECT 1 FROM catalogue_items WHERE id=$1 AND status='active'`, [b.itemId])).rowCount) throw new BadRequestException('Unknown or inactive item');
      const r = await c.query(`UPDATE contract_lines SET item_id=$2, status='approved' WHERE id=$1 AND status='needs_review' RETURNING id`, [id, b.itemId]);
      if (!r.rowCount) throw new ConflictException('Line is not awaiting review');
      await c.query(`UPDATE match_candidates SET status='rejected', decided_by=$2, decided_at=now(), decision_reason='manual mapping chosen' WHERE contract_line_id=$1 AND status='pending'`, [id, ctx.userId]);
      await audit(c, ctx, 'mapping.manual', 'contract_line', id, b);
      return { ok: true };
    });
  }

  @Perm('contracts:review')
  @Post('review/lines/:id/reject')
  async rejectLine(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: { reason?: string }) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(`UPDATE contract_lines SET status='rejected' WHERE id=$1 AND status='needs_review' RETURNING id`, [id]);
      if (!r.rowCount) throw new ConflictException('Line is not awaiting review');
      await c.query(`UPDATE match_candidates SET status='rejected', decided_by=$2, decided_at=now(), decision_reason='line rejected' WHERE contract_line_id=$1 AND status='pending'`, [id, ctx.userId]);
      await audit(c, ctx, 'line.rejected', 'contract_line', id, { reason: b?.reason });
      return { ok: true };
    });
  }

  // ───────── approval & publication ─────────
  @Perm('contracts:approve')
  @Post('contracts/:id/approve')
  async approve(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(ctx, async (c) => {
      const ct = (await c.query(`SELECT * FROM contracts WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!ct) throw new NotFoundException();
      if (ct.status !== 'in_review') throw new ConflictException(`Contract is ${ct.status}, not in_review`);
      const lines = (await c.query(
        `SELECT cl.id, cl.line_no, cl.status, cl.item_id, cl.uom, cl.net_price::float AS net_price, cl.moq::float AS moq, cl.qty_cap::float AS qty_cap, i.uom AS item_uom
           FROM contract_lines cl LEFT JOIN catalogue_items i ON i.id=cl.item_id WHERE cl.contract_id=$1`, [id])).rows;
      const scopeCount = (await c.query(`SELECT count(*)::int AS n FROM contract_scopes WHERE contract_id=$1`, [id])).rows[0].n;
      const problems = validateForApproval({ ...ct, valid_from: ct.valid_from, valid_to: ct.valid_to, scopeCount }, lines, new Date().toISOString().slice(0, 10));
      if (problems.length) throw new UnprocessableEntityException({ message: 'Contract failed validation', problems });
      await c.query(`UPDATE contracts SET status='approved', approved_by=$2 WHERE id=$1`, [id, ctx.userId]);
      await audit(c, ctx, 'contract.approved', 'contract', id);
      return { status: 'approved' };
    });
  }

  @Perm('contracts:publish')
  @Post('contracts/:id/publish')
  async publish(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.db.tx(ctx, async (c) => {
      const ct = (await c.query(`SELECT status FROM contracts WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!ct) throw new NotFoundException();
      if (ct.status !== 'approved') throw new ConflictException('Only an approved contract can be published');
      const n = await c.query(`UPDATE contract_lines SET status='published' WHERE contract_id=$1 AND status='approved'`, [id]);
      await c.query(`UPDATE contracts SET status='published', published_at=now() WHERE id=$1`, [id]);
      await audit(c, ctx, 'contract.published', 'contract', id, { lines: n.rowCount });
      return { status: 'published', linesPublished: n.rowCount };
    });
  }
}
