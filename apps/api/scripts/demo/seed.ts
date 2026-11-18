/**
 * ILLUSTRATIVE DEMO DATA. Everything here is fictional (a made-up group, plants, suppliers, prices).
 * It is created through the public API, so contracts go through review → approval → publication and orders go
 * through the supplier portal, exactly like real data. SAP stays the labelled mock adapter.
 */
import { Client } from 'pg';
import { ITEMS, SUPPLIERS, ARCS, ORG_CSV, byKey, ALIASES, ALTERNATIVES, PO_HISTORY } from './data';
import { render } from './images';
import type { OutboxService } from '../../src/outbox/outbox.service';
import type { FollowUpService } from '../../src/buying/followups.service';

export const PW = 'demo-password-123';
export const ACCOUNTS = [
  ['admin@demo.local', 'Customer administrator'], ['requester@demo.local', 'Plant requester · Coastal Power Plant'], ['plantproc@demo.local', 'Plant procurement · Coastal Power Plant'],
  ['requester2@demo.local', 'Requester · Ports (Harbour Terminal, Inland Depot)'], ['requester3@demo.local', 'Requester · Ridge Cement Works'], ['central@demo.local', 'Central procurement (group)'],
  ['approver@demo.local', 'Approver (group)'], ['ops@demo.local', 'ProcMart operations'], ['finance@demo.local', 'Finance'],
  ['shree@demo.local', 'Supplier · Shree Bearings'], ['apex@demo.local', 'Supplier · Apex Industrial'], ['voltline@demo.local', 'Supplier · Voltline Electricals'], ['hydromax@demo.local', 'Supplier · HydroMax Hoses'], ['procmart@demo.local', 'Supplier · ProcMart Direct'],
];

function pdf(lines: string[]): Buffer {
  const text = lines.map((l, i) => `BT /F1 12 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const off: number[] = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out);
}

export async function seedDemo(base: string, adminDbUrl: string, deps: { outbox: OutboxService; followUps: FollowUpService }, log: (s: string) => void = console.log) {
  const call = async (path: string, token: string | null, body?: any, form?: FormData, method?: string) => {
    const r = await fetch(base + path, { method: method ?? (body || form ? 'POST' : 'GET'), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
    const t = await r.text(); if (!r.ok) throw new Error(`${method ?? (body || form ? 'POST' : 'GET')} ${path} → ${r.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : null;
  };
  const login = async (tenant: string, email: string) => (await call('/auth/login', null, { tenant, email, password: email.startsWith('platform') ? 'dev-platform-pass-1' : PW })).token as string;
  const sql = async (q: string, p: any[] = []) => { const c = new Client({ connectionString: adminDbUrl }); await c.connect(); try { return await c.query(q, p); } finally { await c.end(); } };
  const file = (name: string, buf: Buffer | string, extra: Record<string, string> = {}) => { const f = new FormData(); f.append('file', new Blob([buf]), name); for (const [k, v] of Object.entries(extra)) f.append(k, v); return f; };

  // ── customer ──
  const plat = await login('platform', 'platform@monosource.local');
  await call('/platform/tenants', plat, { slug: 'demo', name: 'Meridian Group (illustrative demo)', adminEmail: 'admin@demo.local', adminPassword: PW });
  await sql(`UPDATE tenants SET config = config || '{"demo": true}' WHERE slug='demo'`);
  const admin = await login('demo', 'admin@demo.local');
  const s01 = (await call('/erp-systems', admin, { code: 'S01', name: 'SAP server S01 (simulated)', kind: 'mock-sap' })).id;
  const s02 = (await call('/erp-systems', admin, { code: 'S02', name: 'SAP server S02 (simulated)', kind: 'mock-sap' })).id;
  await call('/org/import', admin, undefined, file('org.csv', ORG_CSV));
  const tree: any[] = await call('/org/tree', admin);
  const node = (n: string) => tree.find((x) => x.name === n || x.code === n)!.id as string;
  const biz = { Power: node('Power'), Ports: node('Ports'), Resources: node('Resources'), Group: node('GROUP') };
  log(`org: ${tree.filter((n) => n.levelType === 'plant').length} plants on 2 servers`);

  // ── rules (jointly approved allocations — illustrative approvals) ──
  const ap = { approvedByCustomer: 'Illustrative approval (demo)', approvedByProcmart: 'Illustrative approval (demo)', status: 'active' };
  await call('/allocations', admin, { scopeNodeId: biz.Power, model: 2, ...ap });
  await call('/allocations', admin, { scopeNodeId: biz.Ports, model: 3, ...ap });
  await call('/allocations', admin, { scopeNodeId: biz.Resources, model: 2, ...ap });
  await call('/allocations', admin, { scopeNodeId: biz.Resources, category: 'lubricants', model: 1, ...ap });
  await call('/policy', admin, { arcPriorityOverDirect: true, procmartMayBid: false, minQuotes: 2, followUp: { ackHours: 24, dispatchHours: 48, deliveryHours: 72, escalateAfter: 2, channels: ['email', 'whatsapp'] } });

  // ── users ──
  const mk = (email: string, name: string, roleKey: string, scopeNodeId?: string, extra: any = {}) => call('/users', admin, { email, name, password: PW, roleKey, scopeNodeId, ...extra });
  await mk('requester@demo.local', 'Riya Sharma', 'requester', node('CPP1')); await mk('plantproc@demo.local', 'Vikram Rao', 'plant_procurement', node('CPP1'));
  await mk('requester2@demo.local', 'Anil Kulkarni', 'requester', biz.Ports); await mk('requester3@demo.local', 'Meera Iyer', 'requester', biz.Resources);
  await mk('central@demo.local', 'Neha Kapoor', 'central_procurement'); await mk('approver@demo.local', 'Rahul Mehta', 'approver'); await mk('ops@demo.local', 'ProcMart Ops', 'procmart_ops'); await mk('finance@demo.local', 'Farah Khan', 'finance');
  // requesters also see the cart/simulate-free flows; plant procurement may award. Requesters can browse analytics? no.

  // ── suppliers ──
  const sup: Record<string, string> = {};
  for (const s of SUPPLIERS) {
    sup[s.key] = (await call('/suppliers', admin, { legalName: s.name, taxId: `DEMO-${s.key.toUpperCase()}`, isProcmart: (s as any).isProcmart === true, contactEmail: s.email, contactPhone: s.phone })).id;
    await call(`/suppliers/${sup[s.key]}/erp-codes`, admin, { erpSystemId: s01, vendorCode: s.s01 }); await call(`/suppliers/${sup[s.key]}/erp-codes`, admin, { erpSystemId: s02, vendorCode: s.s02 });
  }
  for (const [e, n, k] of [['shree@demo.local', 'Shree Bearings (portal)', 'shree'], ['apex@demo.local', 'Apex Industrial (portal)', 'apex'], ['voltline@demo.local', 'Voltline (portal)', 'voltline'], ['hydromax@demo.local', 'HydroMax (portal)', 'hydromax'], ['procmart@demo.local', 'ProcMart Direct (portal)', 'procmart']])
    await mk(e, n, 'supplier', undefined, { kind: 'supplier', supplierId: sup[k] });

  // ── catalogue (+ images, datasheets, attribute templates) ──
  const header = 'name,description,manufacturer,brand,mpn,uom,category,serviceability,server,material_code,' + ['type', 'bore', 'outer', 'seal', 'rating', 'poles', 'curve', 'coil', 'size', 'colour', 'material', 'standard', 'grade', 'pressure', 'construction', 'pack', 'cores', 'area', 'insulation'].map((k) => `spec_${k}`).join(',');
  const specKeys = header.split(',').filter((h) => h.startsWith('spec_')).map((h) => h.slice(5));
  const q = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...ITEMS.map((i) => [i.name, i.description, i.brand, i.brand, i.mpn, i.uom, i.category, i.serviceability ?? '', 'S01', i.s01, ...specKeys.map((k) => i.specs[k] ?? '')].map(q).join(','))].join('\n');
  const imp = await call('/catalogue/import', admin, undefined, file('catalogue.csv', csv)); if (imp.errors.length) throw new Error('catalogue import: ' + imp.errors.join('; '));
  const all: any[] = await call('/catalogue/search?q=', admin); const idOf = Object.fromEntries(ITEMS.map((i) => [i.key, all.find((a) => a.name === i.name).id as string]));
  for (const i of ITEMS) if (i.s02) await sql(`INSERT INTO item_erp_codes(tenant_id,item_id,erp_system_id,material_code) SELECT tenant_id,$1,$2,$3 FROM catalogue_items WHERE id=$1`, [idOf[i.key], s02, i.s02]);
  const attrs: Record<string, [string, string, boolean][]> = {
    bearings: [['bore', 'Bore (mm)', true], ['outer', 'Outer diameter (mm)', false], ['type', 'Bearing type', false], ['seal', 'Seal', false]], electrical: [['rating', 'Current rating', true], ['poles', 'Poles', false], ['curve', 'Trip curve', false], ['type', 'Type', false]],
    ppe: [['type', 'Type', true], ['size', 'Size', false], ['material', 'Material', false], ['standard', 'Standard', false]], fasteners: [['material', 'Material', true], ['size', 'Size', true], ['grade', 'Grade', false], ['type', 'Type', false]],
    valves: [['size', 'Nominal size', true], ['type', 'Valve type', true], ['rating', 'Pressure rating', false], ['material', 'Body material', false]], hoses: [['bore', 'Bore', true], ['pressure', 'Working pressure', false], ['construction', 'Construction', false]],
    lubricants: [['grade', 'Viscosity grade', true], ['pack', 'Pack size', false]], cables: [['cores', 'Cores', true], ['area', 'Conductor area', true], ['insulation', 'Insulation', false]] };
  for (const [category, list] of Object.entries(attrs)) for (const [i, [key, label, required]] of list.entries()) await call('/catalogue/category-attributes', admin, { category, key, label, required, position: i + 1 });
  const palette: Record<string, string> = { Schneider: '#067647', Siemens: '#0c6e86', ABB: '#d94841', Havells: '#d94841' };
  for (const i of ITEMS) {
    const png = await render(i.category, i.color || palette[i.brand] || '#2547d0', { ...(i.art ?? {}), on: true });
    const f = file(`${i.key}.png`, png); f.append('caption', 'Illustrative product image'); await call(`/catalogue/items/${idOf[i.key]}/assets`, admin, undefined, f);
  }
  for (const k of ['b6205s', 'b6306s', 'mcb32', 'vball', 'h34']) { const i = byKey[k]; await call(`/catalogue/items/${idOf[k]}/assets`, admin, undefined, file(`${i.mpn}-datasheet.pdf`, pdf([`${i.name} - datasheet (ILLUSTRATIVE)`, `${i.brand} ${i.mpn}`, ...Object.entries(i.specs).map(([a, b]) => `${a}: ${b}`)]))); }
  await call(`/catalogue/items/${idOf.b6205s}/update`, admin, { description: 'Single-row deep groove ball bearing with contact seals on both sides, 25 mm bore. Suitable for electric motors, pumps and conveyors.' });
  log(`catalogue: ${ITEMS.length} items with images`);

  // ── ARCs: upload → human review (approve exact matches) → approve → publish ──
  for (const a of ARCS) {
    const lines = ['Description,Supplier Item Code,Material Code,Brand,MPN,UOM,Base Price,Discount %,MOQ,Quantity Cap', ...a.lines.map((l) => { const it = byKey[l.item]; return [`${it.mpn} ${it.brand.toUpperCase()} ${it.category.toUpperCase()} AS PER CONTRACT`, `${a.supplier.slice(0, 3).toUpperCase()}-${it.mpn}`, a.erp === 'S02' && it.s02 ? it.s02 : it.s01, it.brand, it.mpn, it.uom === 'EA' ? 'Nos' : it.uom, l.base, l.disc, l.moq, l.cap].map(q).join(','); })].join('\n');
    const up = await call('/contracts', admin, undefined, file(`${a.number}.csv`, lines, { contractType: a.type, number: a.number, supplierId: sup[a.supplier], erpSystemId: a.erp === 'S01' ? s01 : s02, validFrom: a.from, validTo: a.to, scopeNodeIds: a.scopes.map((s) => (biz as any)[s]).join(',') }));
    if (up.status !== 'in_review') throw new Error(`${a.number}: ${JSON.stringify(up)}`);
    const queue: any[] = await call('/review/queue', admin);
    for (const l of queue.filter((x) => x.contractId === up.id)) { const c = l.candidates.find((x: any) => x.basis === 'exact_code'); if (!c) throw new Error(`${a.number} line ${l.lineNo}: no exact match`); await call(`/review/candidates/${c.id}/decision`, admin, { decision: 'approve', reason: 'Illustrative demo data' }); }
    await call(`/contracts/${up.id}/approve`, admin, {}); await call(`/contracts/${up.id}/publish`, admin, {});
  }
  await sql(`UPDATE contracts SET valid_from='2025-04-01', valid_to='2026-03-31', status='expired' WHERE number='ARC-25-VAL-009'`); // an ended contract: known supplier, no current contract (case D)
  log(`contracts: ${ARCS.length} published`);
  // how people describe items, approved alternatives, PO history (simulated SAP feed)
  for (const [k, list] of Object.entries(ALIASES)) for (const [kind, value, sk] of list) await call(`/catalogue/items/${idOf[k]}/aliases`, admin, { kind, value, supplierId: sk ? sup[sk] : undefined });
  for (const [a, b, note] of ALTERNATIVES) await call('/catalogue/alternatives', admin, { itemId: idOf[a], alternativeItemId: idOf[b], note });
  const poCsv = ['po_number,po_date,server,plant_code,material_code,vendor_code,vendor_name,qty,uom,unit_price', ...PO_HISTORY.map((h) => { const it = byKey[h.item]; return [h.po, h.date, h.server, h.plant, h.server === 'S02' && it.s02 ? it.s02 : it.s01, h.vendorCode, h.vendor, h.qty, it.uom, h.price].map(q).join(','); })].join('\n');
  const poImp = await call('/po-history/import', admin, undefined, file('po-history.csv', poCsv)); if (poImp.errors.length) throw new Error('po history: ' + poImp.errors.join('; '));
  log(`po history: ${poImp.imported} lines`);

  // ── orders (through the real buying, supplier-portal and simulated-ERP paths) ──
  const U: Record<string, string> = {};
  for (const e of ['requester', 'plantproc', 'requester2', 'requester3', 'central', 'approver', 'ops', 'shree', 'apex', 'voltline', 'hydromax', 'procmart']) U[e] = await login('demo', `${e}@demo.local`);
  const plantId = (c: string) => node(c);
  const supplyId = async (t: string, plant: string, item: string, supplier: string) => { const p = await call(`/products/${idOf[item]}?plantId=${plant}`, t); const s = p.supplies.find((x: any) => x.supplier === SUPPLIERS.find((y) => y.key === supplier)!.name); if (!s) throw new Error(`no supply ${item}/${supplier}`); return s.contractLineId as string; };
  const order = async (user: string, plant: string, lines: { item: string; qty: number; supplier?: string; needBy?: string }[]) => {
    for (const l of lines) await call('/cart/items', U[user], { plantId: plant, itemId: idOf[l.item], qty: l.qty, needBy: l.needBy, contractLineId: l.supplier ? await supplyId(U[user], plant, l.item, l.supplier) : undefined });
    const cart = await call(`/cart?plantId=${plant}`, U[user]); const sub = await call(`/cart/${cart.cartId}/submit`, U[user], {});
    await deps.outbox.runOnce(); return call(`/requirements/${sub.requirementId}`, U[user]);
  };
  const sim = (t: string, sid: string, step: string) => call(`/streams/${sid}/simulate`, t, { step });
  const portal = (sup: string, sid: string, what: string, body: any) => call(`/portal/orders/${sid}/${what}`, U[sup], body);
  const lineOf = (req: any, item: string) => req.lines.find((l: any) => l.item_name === byKey[item].name);
  const streamOf = (req: any, supplier: string) => req.streams.find((s: any) => s.supplier_name === SUPPLIERS.find((x) => x.key === supplier)!.name);
  const plantproc = admin; // ERP-side simulated steps are performed with the customer admin token

  // R1 — complete lifecycle, one rejection at receipt  (Coastal Power Plant)
  let r = await order('requester', plantId('CPP1'), [{ item: 'b6205s', qty: 20, supplier: 'shree', needBy: '2026-11-30' }, { item: 'mcb32', qty: 10, needBy: '2026-12-05' }]);
  for (const [s, who, item, acc, rej] of [['shree', 'shree', 'b6205s', 18, 2], ['voltline', 'voltline', 'mcb32', 10, 0]] as const) {
    const st = streamOf(r, s); await sim(plantproc, st.id, 'po_released'); const ln = lineOf(r, item).id; const qty = Number(lineOf(r, item).qty);
    await portal(who, st.id, 'acknowledge', { lines: [{ lineId: ln, qty, date: '2026-11-12' }] }); await portal(who, st.id, 'dispatch', { lines: [{ lineId: ln, qty }], carrier: 'BlueDart Cargo (demo)', trackingRef: `TRK-${s.slice(0, 3).toUpperCase()}-1`, expectedDate: '2026-11-12', invoiceNumber: `INV-${s.slice(0, 3).toUpperCase()}-101` });
    await call(`/streams/${st.id}/grn`, plantproc, { lines: [{ lineId: ln, accepted: acc, rejected: rej }] });
    await portal(who, st.id, 'invoice', { invoiceNumber: `INV-${s.slice(0, 3).toUpperCase()}-101`, amount: Math.round(Number(lineOf(r, item).unit_price) * acc) });
    if (s === 'voltline') await sim(plantproc, st.id, 'paid');
  }
  // R2 — partly dispatched (partial commitment) + a late shipment
  r = await order('requester', plantId('CPP1'), [{ item: 'b6306s', qty: 40, supplier: 'apex' }, { item: 'bolt316', qty: 400, needBy: '2026-11-10' }]);
  { const st = streamOf(r, 'apex'), ln = lineOf(r, 'b6306s').id; await sim(plantproc, st.id, 'po_released'); await portal('apex', st.id, 'acknowledge', { lines: [{ lineId: ln, qty: 30, date: '2026-11-20', note: 'Balance 10 in two weeks' }] }); await portal('apex', st.id, 'dispatch', { lines: [{ lineId: ln, qty: 18 }], carrier: 'Gati Express (demo)', trackingRef: 'TRK-APX-7', expectedDate: '2026-11-09' }); }
  { const st = r.streams.find((s: any) => s.supplier_name === 'Boltcraft Fasteners'); await sim(plantproc, st.id, 'po_released'); } // Boltcraft has no portal user in the demo, so this order stays at "order placed"

  // R3 — waiting for supplier confirmation (follow-ups will have chased) + a line with no contract at a Power plant
  r = await order('central', plantId('NPP2'), [{ item: 'h34', qty: 100, needBy: '2026-12-01' }, { item: 'cab3c', qty: 500 }]);
  { const st = streamOf(r, 'hydromax'); await sim(plantproc, st.id, 'po_released'); await sql(`UPDATE streams SET status_at = now() - interval '52 hours' WHERE id=$1`, [st.id]); }
  // R4 — Ports: ARC order with the buyer's chosen supplier (Apex) + an item that needs quotes
  r = await order('requester2', plantId('HT01'), [{ item: 'b6205s', qty: 30, supplier: 'apex' }, { item: 'cab4c', qty: 300, needBy: '2026-12-15' }]);
  { const st = streamOf(r, 'apex'), ln = lineOf(r, 'b6205s').id; await sim(plantproc, st.id, 'po_released'); await portal('apex', st.id, 'acknowledge', { lines: [{ lineId: ln, qty: 30, date: '2026-11-24' }] }); }
  const rfq1 = await call('/rfqs', U.ops, { requirementId: r.id, requirementLineIds: [lineOf(r, 'cab4c').id], supplierIds: [sup.voltline, sup.apex, sup.boltcraft] });
  { const rr = await call(`/rfqs/${rfq1.id}`, U.ops); const l = rr.comparison[0].id; for (const [s, p, f, d] of [[sup.voltline, 372, 6, 10], [sup.apex, 391, 4, 7]] as const) await call(`/rfqs/${rfq1.id}/quotes`, U.ops, { supplierId: s, lines: [{ rfqLineId: l, unitPrice: p, freightPerUnit: f, leadTimeDays: d, uom: 'M' }] }); await call(`/rfqs/${rfq1.id}/close`, U.ops, {}); }
  // R5 — Ports: RFQ awarded to a non-L1 supplier with a recorded reason, order in progress
  r = await order('requester2', plantId('ICD3'), [{ item: 'vbfly', qty: 4, needBy: '2026-12-10' }, { item: 'helmy', qty: 60 }]);
  { const rfq = await call('/rfqs', U.ops, { requirementId: r.id, requirementLineIds: [lineOf(r, 'vbfly').id], supplierIds: [sup.flowtech, sup.hydromax, sup.boltcraft] }); const rr = await call(`/rfqs/${rfq.id}`, U.ops); const l = rr.comparison[0].id;
    for (const [s, p, f, d] of [[sup.flowtech, 21800, 350, 21], [sup.hydromax, 20900, 500, 30], [sup.boltcraft, 24100, 300, 14]] as const) await call(`/rfqs/${rfq.id}/quotes`, U.ops, { supplierId: s, lines: [{ rfqLineId: l, unitPrice: p, freightPerUnit: f, leadTimeDays: d, uom: 'EA' }] });
    await call(`/rfqs/${rfq.id}/close`, U.ops, {}); const c = (await call(`/rfqs/${rfq.id}`, U.ops)).comparison[0]; const pick = c.ranked.find((x: any) => x.supplierName === 'Flowtech Valves & Fittings');
    await call(`/rfqs/${rfq.id}/award`, U.approver, { awards: [{ rfqLineId: l, quoteLineId: pick.quoteLineId, reason: 'Shortest lead time for planned shutdown; incumbent supplier (illustrative)' }] }); await deps.outbox.runOnce();
    r = await call(`/requirements/${r.id}`, U.requester2); const st = streamOf(r, 'flowtech'); await sim(plantproc, st.id, 'po_released'); }
  // R6 — Resources (second ERP server): ProcMart direct supply + PPE on QRC
  r = await order('requester3', plantId('RCW1'), [{ item: 'gear220', qty: 8, needBy: '2026-11-28' }, { item: 'glovn', qty: 120 }]);
  { const st = streamOf(r, 'procmart'), ln = lineOf(r, 'gear220').id; await sim(plantproc, st.id, 'po_released'); await portal('procmart', st.id, 'acknowledge', { lines: [{ lineId: ln, qty: 8, date: '2026-11-22' }] }); await portal('procmart', st.id, 'dispatch', { lines: [{ lineId: ln, qty: 8 }], carrier: 'ProcMart Logistics (demo)', trackingRef: 'PM-5521', expectedDate: '2026-11-21' }); }
  // R7 — below the contract minimum → ProcMart sources it instead + a supplier that declines
  r = await order('requester', plantId('CPP1'), [{ item: 'mcb16', qty: 2 }]);
  r = await order('central', plantId('NPP2'), [{ item: 'b30208', qty: 6 }]);
  { const st = streamOf(r, 'shree'), ln = lineOf(r, 'b30208').id; await sim(plantproc, st.id, 'po_released'); await portal('shree', st.id, 'acknowledge', { lines: [{ lineId: ln, qty: 0, note: 'Out of stock until January' }] }); }
  // R8 — high utilisation on the hose ARC
  r = await order('central', plantId('NPP2'), [{ item: 'h34', qty: 10 }]);

  // A non-catalogue request already with ProcMart (ARCs are group-level, so there are no plant coverage requests)
  { const nc = await call('/cart/non-catalogue', U.requester2, { plantId: plantId('HT01'), name: 'Anti-vibration rubber mounts 40 × 40 mm', brand: 'Any equivalent', spec: 'M8 stud, shore 60, for conveyor drive frame', reason: 'Replacing worn mounts on crane drive', qty: 24, uom: 'EA', needBy: '2026-12-20' }); const cart = await call(`/cart?plantId=${plantId('HT01')}`, U.requester2); await call(`/cart/${cart.cartId}/submit`, U.requester2, {}); void nc; }

  // MAIN AGENTIC SCENARIO (simulated): 500 FAG bearings at Ridge Cement Works; no group ARC covers them, so ProcMart collects quotations.
  let scen = '';
  { const pl = plantId('RCW1'); await call('/cart/items', U.requester3, { plantId: pl, itemId: idOf.b6205f, qty: 500, intent: 'source', note: 'Need 500 for the crusher line overhaul.' });
    const cart = await call(`/cart?plantId=${pl}`, U.requester3); const sub = await call(`/cart/${cart.cartId}/submit`, U.requester3, {}); scen = sub.requirementId;
    await call(`/requirements/${scen}/demo/advance`, U.central, {}); await call(`/requirements/${scen}/demo/advance`, U.central, {}); }

  // saved items for the requester
  for (const k of ['b6205s', 'mcb32', 'helmy', 'vball']) await call(`/saved/${idOf[k]}`, U.requester, {});

  // spread timestamps over the last ~6 weeks so lists look lived-in: every record of a requirement moves by the same offset, so timelines stay consistent
  await sql(`CREATE TEMP TABLE off AS SELECT id, ((SELECT count(*) FROM requirements) - n) * interval '4 days' AS d FROM (SELECT id, row_number() OVER (ORDER BY created_at) AS n FROM requirements) x;
    UPDATE requirements r SET created_at = r.created_at - off.d FROM off WHERE off.id = r.id;
    UPDATE order_events e SET at = e.at - off.d FROM off WHERE e.requirement_id = off.id;
    UPDATE streams s SET created_at = s.created_at - off.d, status_at = s.status_at - off.d FROM off WHERE s.requirement_id = off.id;
    UPDATE shipments x SET at = x.at - off.d FROM streams s, off WHERE s.id = x.stream_id AND off.id = s.requirement_id;
    UPDATE grn_receipts x SET at = x.at - off.d FROM streams s, off WHERE s.id = x.stream_id AND off.id = s.requirement_id;
    UPDATE invoices x SET at = x.at - off.d FROM streams s, off WHERE s.id = x.stream_id AND off.id = s.requirement_id;
    UPDATE exceptions x SET created_at = x.created_at - off.d FROM off WHERE x.requirement_id = off.id;
    UPDATE rfqs x SET created_at = x.created_at - off.d FROM off WHERE x.requirement_id = off.id;`);
  await sql(`UPDATE requirements SET created_at = now() - interval '2 days 5 hours' WHERE id = $1`, [scen]);
  await sql(`UPDATE notifications n SET created_at = r.created_at + interval '20 minutes' + x.rn * interval '6 hours', read_at = CASE WHEN n.requirement_id <> $1 OR x.rn < x.cnt - 3 THEN r.created_at + interval '1 day' ELSE NULL END
             FROM requirements r, (SELECT id, requirement_id, row_number() OVER (PARTITION BY requirement_id ORDER BY created_at, id) - 1 AS rn, count(*) OVER (PARTITION BY requirement_id) AS cnt FROM notifications) x
             WHERE x.id = n.id AND r.id = n.requirement_id`, [scen]);
  await sql(`UPDATE streams SET status_at = now() - interval '52 hours' WHERE status='po_released' AND supplier_id=(SELECT id FROM suppliers WHERE legal_name='HydroMax Hoses')`);
  const fu = await deps.followUps.scan(); log(`follow-ups: ${JSON.stringify(fu)}`);
  log('demo data ready');
}
