import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Db } from '../db/db';
import { audit, CurrentCtx, Ctx, Perm } from '../common/security';

class SupplierDto {
  @IsString() @Length(2, 200) legalName: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() isProcmart?: boolean;
  @IsOptional() @IsString() contactEmail?: string;
  @IsOptional() @IsString() contactPhone?: string;
}
class ErpCodeDto {
  @IsUUID() erpSystemId: string;
  @IsString() @Length(1, 40) vendorCode: string;
}

@Controller('suppliers')
export class SuppliersController {
  constructor(private db: Db) {}

  /** A new legal entity is always a new supplier. Similar names / tax ids are NOT merged automatically. */
  @Perm('suppliers:write')
  @Post()
  create(@CurrentCtx() ctx: Ctx, @Body() b: SupplierDto) {
    return this.db.tx(ctx, async (c) => {
      const r = await c.query(`INSERT INTO suppliers(tenant_id,legal_name,tax_id,is_procmart,contact_email,contact_phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [ctx.tenantId, b.legalName, b.taxId ?? null, b.isProcmart === true, b.contactEmail ?? null, b.contactPhone ?? null]);
      const possible = await c.query(`SELECT id, legal_name FROM suppliers WHERE id<>$1 AND (lower(legal_name)=lower($2) OR ($3::text IS NOT NULL AND tax_id=$3))`, [r.rows[0].id, b.legalName, b.taxId ?? null]);
      await audit(c, ctx, 'supplier.created', 'supplier', r.rows[0].id, b);
      return { id: r.rows[0].id, possibleDuplicates: possible.rows }; // surfaced for authorised human review, never auto-merged
    });
  }

  @Perm('suppliers:write')
  @Post(':id/erp-codes')
  addCode(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: ErpCodeDto) {
    return this.db.tx(ctx, async (c) => {
      if (!(await c.query(`SELECT 1 FROM suppliers WHERE id=$1`, [id])).rowCount) throw new NotFoundException();
      if (!(await c.query(`SELECT 1 FROM erp_systems WHERE id=$1`, [b.erpSystemId])).rowCount) throw new BadRequestException('Unknown ERP system');
      try {
        await c.query(`INSERT INTO supplier_erp_codes(tenant_id,supplier_id,erp_system_id,vendor_code) VALUES ($1,$2,$3,$4)`, [ctx.tenantId, id, b.erpSystemId, b.vendorCode]);
      } catch (e: any) {
        if (e.code === '23505') throw new ConflictException('That vendor code on that ERP already belongs to a supplier');
        throw e;
      }
      await audit(c, ctx, 'supplier.erp_code_added', 'supplier', id, b);
      return { ok: true };
    });
  }

  @Perm('suppliers:read')
  @Get()
  list(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) =>
      (await c.query(
        `SELECT s.id, s.legal_name AS "legalName", s.tax_id AS "taxId", s.status, s.is_procmart AS "isProcmart",
           coalesce(json_agg(json_build_object('server', e.code, 'vendorCode', sc.vendor_code)) FILTER (WHERE sc.id IS NOT NULL), '[]') AS "erpCodes"
         FROM suppliers s LEFT JOIN supplier_erp_codes sc ON sc.supplier_id=s.id LEFT JOIN erp_systems e ON e.id=sc.erp_system_id
         GROUP BY s.id ORDER BY s.legal_name`)).rows);
  }
}
