import { PoolClient } from 'pg';

export interface CoverageLine {
  contract_line_id: string;
  contract_id: string;
  contract_type: 'ARC' | 'QRC' | 'PROCMART_DIRECT';
  contract_number: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  item_id: string;
  uom: string | null;
  net_price: string | null;
  moq: string | null;
  qty_cap: string | null;
  used_qty: string;
  valid_to: string | null;
  scope_depth: number; // 0 = scope node is the plant itself; higher = broader
}

/**
 * Published, in-validity contract lines for the given items. ARCs/QRCs are GROUP-LEVEL: a live contract
 * applies at every plant of the customer, so there is no plant applicability step. plantId is kept for the
 * signature (and scope_depth stays 0) so callers do not change.
 * "Customer contract coverage" only — ProcMart serviceability is a separate field on the item.
 */
export async function applicableLines(c: PoolClient, _plantId: string, itemIds: string[], onDate: string): Promise<CoverageLine[]> {
  if (!itemIds.length) return [];
  const r = await c.query(
    `SELECT cl.id AS contract_line_id, ct.id AS contract_id, ct.contract_type, ct.number AS contract_number,
            ct.supplier_id, s.legal_name AS supplier_name, cl.item_id, cl.uom, cl.net_price, cl.moq, cl.qty_cap,
            coalesce((SELECT sum(rl.qty) FROM requirement_lines rl WHERE rl.contract_line_id = cl.id),0) AS used_qty,
            ct.valid_to, 0 AS scope_depth
       FROM contract_lines cl
       JOIN contracts ct ON ct.id = cl.contract_id
       LEFT JOIN suppliers s ON s.id = ct.supplier_id
      WHERE cl.status = 'published' AND ct.status = 'published' AND cl.item_id = ANY($1::uuid[])
        AND (ct.valid_from IS NULL OR ct.valid_from <= $2::date) AND (ct.valid_to IS NULL OR ct.valid_to >= $2::date)`,
    [itemIds, onDate],
  );
  return r.rows;
}
