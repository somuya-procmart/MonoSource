'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API, api, getToken } from '../lib/api';
import { can, useApp } from '../app/shell';
import { Icon, categoryIcon } from './Icon';
import { AuthImage } from './AuthImage';
import { Heart, Qty } from './ProductBits';
import { Thumb } from './Thumb';
import { SourceBadge, pmPrice } from './Source';
import { SupplierDrawer } from './SupplierDrawer';
import { dmy, inr, num, price } from '../lib/format';
import { useOpenProduct } from './ProductPanel';

const KIND: Record<string, string> = { sap_description: 'SAP description', common_name: 'Common name', application: 'Used for', supplier_code: 'Supplier code' };

/**
 * The answer to "How can I buy this for my plant?" — one case (A–F) with the evidence and the next action,
 * then the product facts. Used as a side panel over results and as a full page.
 */
export function ProductDetail({ id, variant, onClose }: { id: string; variant: 'panel' | 'page'; onClose?: () => void }) {
  const { me, plant, plants, notify, refreshCart, openCart } = useApp(); const { open: openProduct } = useOpenProduct();
  const [p, setP] = useState<any>(null); const [err, setErr] = useState(''); const [sel, setSel] = useState<string | null>(null); const [qty, setQty] = useState(1); const [img, setImg] = useState(0);
  const [busy, setBusy] = useState(false); const [supplier, setSupplier] = useState<string | null>(null); const [confirm, setConfirm] = useState<Record<string, boolean>>({});
  const plantName = plants.find((x) => x.id === plant)?.name;
  const load = useCallback(() => { setP(null); api(`/products/${id}${plant ? `?plantId=${plant}` : ''}`).then((d) => { setP(d); setErr('');
    const ok = d.source.supplies; setSel(ok[0]?.contractLineId ?? null); // cheapest first (API sorts by price) setQty(Math.max(1, Number(ok[0]?.moq ?? 1)));
    try { const v = JSON.parse(localStorage.getItem('ms_viewed') || '[]').filter((x: any) => x.id !== d.id); localStorage.setItem('ms_viewed', JSON.stringify([{ id: d.id, name: d.name, imageId: d.assets.find((a: any) => a.kind === 'image')?.id, category: d.category }, ...v].slice(0, 8))); } catch { /* ignore */ } }).catch((e) => setErr(e.message)); }, [id, plant]);
  useEffect(load, [load]);
  const src = p?.source; const supply = useMemo(() => src?.supplies.find((s: any) => s.contractLineId === sel) ?? null, [src, sel]);

  const afterAdd = async (text: string) => { await refreshCart(); notify(text); onClose?.(); openCart(); };
  const add = async (body: any, text: string) => { setBusy(true); try { await api('/cart/items', { body: { plantId: plant, ...body } }); await afterAdd(text); } catch (e: any) { notify(e.message, { error: true }); } setBusy(false); };
    const download = async (a: any) => { const r = await fetch(`${API}/catalogue/assets/${a.id}`, { headers: { Authorization: `Bearer ${getToken()}` } }); const l = document.createElement('a'); l.href = URL.createObjectURL(await r.blob()); l.download = a.filename; l.click(); URL.revokeObjectURL(l.href); };

  if (err) return <div style={{ padding: 24 }}><div className="empty"><div className="eic"><Icon name="alert" size={24} /></div><b>We couldn’t open this product</b>{err}</div></div>;
  if (!p) return <div style={{ padding: 24, display: 'grid', gap: 14 }}><div className="skel" style={{ height: 130 }} /><div className="skel" style={{ height: 220 }} /><div className="skel" style={{ height: 160 }} /></div>;

  const images = p.assets.filter((a: any) => a.kind === 'image'); const docs = p.assets.filter((a: any) => a.kind === 'document');
  const attrs: any[] = p.attributes ?? []; const specRows = [...attrs.filter((a) => p.specs?.[a.key] !== undefined).map((a) => [a.label, p.specs[a.key]]), ...Object.entries(p.specs ?? {}).filter(([k]) => !attrs.some((a) => a.key === k)).map(([k, v]) => [k.replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), v])] as [string, string][];
  const minOrder = Number((supply ?? src.supplies[0])?.moq ?? 1);
  const priced = src.supplies.filter((s: any) => s.netPrice != null); const lowest = priced.length ? Math.min(...priced.map((s: any) => s.netPrice)) : null;
  const aliasGroups = Object.entries(p.aliases.reduce((m: any, a: any) => ((m[a.kind] ??= []).push(a.value), m), {})) as [string, string[]][];

  return <div className="pdx" style={variant === 'panel' ? { display: 'flex', flexDirection: 'column', height: 'calc(100% - 59px)' } : undefined}>
    <div className="pd-body" style={variant === 'panel' ? { flex: 1, overflow: 'auto', padding: '18px 22px 24px' } : undefined}>
      {/* identity */}
      <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) auto', gap: 18, alignItems: 'start', marginBottom: 18 }}>
        <div><div className="pthumb" style={{ width: 150, height: 130, borderRadius: 14 }}><AuthImage key={images[img]?.id ?? 'x'} assetId={images[img]?.id} fallback={<Icon name={categoryIcon(p.category)} size={60} />} /></div>
          {images.length > 1 && <div className="row" style={{ marginTop: 6, gap: 6 }}>{images.map((a: any, i: number) => <button key={a.id} className="sec" style={{ width: 34, height: 34, padding: 0, overflow: 'hidden', borderColor: i === img ? 'var(--pri)' : undefined }} onClick={() => setImg(i)} aria-label={`Image ${i + 1}`}><AuthImage assetId={a.id} fallback={null} /></button>)}</div>}</div>
        <div style={{ minWidth: 0 }}><h1 style={{ fontSize: 22, marginBottom: 4 }}>{p.name}</h1>
          <div className="mut" style={{ marginBottom: 8 }}>{[p.brand, p.mpn && `Part ${p.mpn}`].filter(Boolean).join(' · ')}</div>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>{p.codes.map((x: any) => <span key={x.server + x.code} className="tag">Material code {x.code}<span className="mut" style={{ fontWeight: 500 }}>&nbsp;({x.server})</span></span>)}<span className="tag" style={{ textTransform: 'capitalize' }}>{p.category}</span><span className="tag">Unit {p.uom}</span></div>
          {p.description && <p className="mut" style={{ margin: 0, fontSize: 13 }}>{p.description}</p>}</div>
        <div style={{ display: 'flex', gap: 8 }}><Heart item={{ id: p.id, saved: p.saved }} />{variant === 'panel' && <Link href={`/product/${p.id}`} className="btn ghost sm" style={{ height: 34 }} title="Open as a full page"><Icon name="external" size={15} /></Link>}</div>
      </div>

      {/* THE answer: on a group contract, or ProcMart gets it */}
      {!plant ? <section className="buy-box"><div className="buy-head"><span className="buy-ic"><Icon name="pin" size={20} /></span><div><b>Pick your plant to order</b></div></div></section>
        : src.case === 'A' ? <section className="buy-box">
          <div className="buy-head"><span className="buy-ic ok"><Icon name="checkCircle" size={20} /></span><div><b>On group contract</b><small>{src.supplies.length > 1 ? `${src.supplies.length} suppliers · pick one` : 'Fixed price, ordered on the ARC'}</small></div></div>
          <div className="offers" role="radiogroup" aria-label="Supplier">{src.supplies.map((s: any) => { const on = s.contractLineId === sel; const best = src.supplies.length > 1 && s.netPrice === lowest; const soon = s.daysLeft !== null && s.daysLeft <= 45;
            return <label key={s.contractLineId} className={`offer ${on ? 'on' : ''}`}>
              <input type="radio" name="supply" checked={on} onChange={() => { setSel(s.contractLineId); setQty((q) => Math.max(q, Number(s.moq ?? 1))); }} />
              <span className="offer-av" aria-hidden>{s.supplier.split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('')}</span>
              <span className="offer-who"><button type="button" className="offer-name" onClick={(e) => { e.preventDefault(); setSupplier(s.supplierId); }}>{s.supplier}</button><small>{s.number}{s.moq ? ` · Min ${num(s.moq)} ${s.uom}` : ''}</small></span>
              <span className="offer-price">{s.netPrice == null ? <small>Rate as per ARC in SAP</small> : <><b>{price(s.netPrice)}</b><small>/ {s.uom}</small></>}</span>
              <span className="offer-tags">{best && <span className="h-pill ok">Lowest</span>}{soon && <span className="h-pill warn">Ends in {s.daysLeft}d</span>}</span>
            </label>; })}</div>
        </section>
        : <section className="buy-box">
          <div className="buy-head"><span className="buy-ic pm"><Icon name="zap" size={20} /></span><div><b>Via ProcMart</b><small>{pmPrice(p) != null ? <>ProcMart price list · <b>{price(pmPrice(p)!)}</b> / {p.uom}</> : 'No group contract. ProcMart quotes and supplies it.'}</small></div></div>
          <div className="row" style={{ alignItems: 'center', margin: 0, gap: 12 }}><Qty value={qty} onChange={setQty} /><button className="btn pri" disabled={busy} onClick={() => add({ itemId: id, qty, intent: 'source' }, `Added ${qty} × ${p.name}`)}><Icon name="cart" size={17} />Add to requirement</button></div>
        </section>}

      {/* F */}
      {p.alternatives.length > 0 && <section className="card"><div className="sec-head" style={{ marginBottom: 8 }}><div><h2 style={{ margin: 0 }}>Possible alternatives</h2></div></div>
        <div style={{ display: 'grid', gap: 12 }}>{p.alternatives.map((a: any) => { const sa = a.source; const ok = a.status === 'approved' || confirm[a.id];
          return <div key={a.id} style={{ border: '1px solid var(--bd)', borderRadius: 14, padding: 12 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="sb-th" style={{ width: 52, height: 52 }}><Thumb imageId={a.imageId} category={a.category} size={52} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><b>{a.name}</b><div className="psub">{[a.brand, a.mpn].filter(Boolean).join(' · ')}</div></div>
              <span className={`tag ${a.status === 'approved' ? 'ok' : 'warn'}`}>{a.status === 'approved' ? 'Approved equivalent' : 'Suggested — check before use'}</span></div>
            <div style={{ overflowX: 'auto', marginTop: 8 }}><table style={{ fontSize: 13 }}><tbody>{a.diff.map((d: any) => <tr key={d.key} style={!d.same ? { background: '#fffdf5' } : undefined}><td style={{ width: '34%', color: 'var(--mut)', padding: '5px 8px' }}>{d.label}</td><td style={{ padding: '5px 8px' }}>{d.here ?? '—'}</td><td style={{ padding: '5px 8px', fontWeight: d.same ? 400 : 700 }}>{d.there ?? '—'}{!d.same && <span className="tag warn" style={{ marginLeft: 6 }}>differs</span>}</td></tr>)}</tbody><thead><tr><th style={{ padding: '4px 8px' }} /><th style={{ padding: '4px 8px' }}>This item</th><th style={{ padding: '4px 8px' }}>Alternative</th></tr></thead></table></div>
            {a.note && <div className="mut" style={{ fontSize: 12, marginTop: 6 }}>{a.note}</div>}
            <div className="row" style={{ marginTop: 10, marginBottom: 0, alignItems: 'center' }}>{plant && <SourceBadge src={sa} plant compact />}{sa?.lowestPrice != null && <b>{price(sa.lowestPrice)}</b>}<span style={{ flex: 1 }} />
              {a.status === 'suggested' && <label className="row" style={{ marginBottom: 0, gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!confirm[a.id]} onChange={(e) => setConfirm({ ...confirm, [a.id]: e.target.checked })} />I confirm it is technically suitable</label>}
              <button className="sec" onClick={() => openProduct(a.id)}>View</button>
              {plant && sa?.case === 'A' && !sa.multiple && <button className="btn sm pri" disabled={!ok || busy} onClick={() => add({ itemId: a.id, qty: Math.max(1, Number(sa.supplies[0].moq ?? 1)), contractLineId: sa.supplies[0].contractLineId, note: `Substitute for ${p.name}${a.status === 'suggested' ? ' — requester confirmed technical suitability' : ' — approved equivalent'}` }, `Added ${a.name} as a substitute`)}>Add as substitute</button>}</div></div>; })}</div></section>}

      <section className="card"><h2>Specifications</h2>{specRows.length ? <table><tbody>{specRows.map(([k, v]) => <tr key={k}><td style={{ width: '38%', color: 'var(--mut)' }}>{k}</td><td><b>{v}</b></td></tr>)}<tr><td style={{ color: 'var(--mut)' }}>Unit of measure</td><td><b>{p.uom}</b></td></tr></tbody></table> : <div className="mut">No specifications recorded for this item yet.</div>}
        {aliasGroups.length > 0 && <div style={{ marginTop: 14 }}><div className="mut" style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>ALSO KNOWN AS</div>{aliasGroups.map(([k, vs]) => <div key={k} className="row" style={{ marginBottom: 4 }}><span className="mut" style={{ width: 120, fontSize: 13 }}>{KIND[k] ?? k}</span>{vs.map((v) => <span key={v} className="tag">{v}</span>)}</div>)}</div>}</section>

      {(docs.length > 0 || src.supplies.length > 0) && <section className="card">
        {docs.length > 0 && <><h2>Documents</h2>{docs.map((d: any) => <div key={d.id} className="row"><Icon name="file" size={18} /><b>{d.filename}</b><span className="mut" style={{ fontSize: 12 }}>{Math.round(d.sizeBytes / 1024)} KB</span><button className="sec" onClick={() => download(d)}><Icon name="download" size={15} />Download</button></div>)}</>}
        {src.supplies.length > 0 && <details style={{ marginTop: docs.length ? 12 : 0 }}><summary><Icon name="chevronRight" size={14} />Contract conditions</summary>
          {src.supplies.map((s: any) => <dl key={s.contractLineId} className="kv" style={{ margin: '10px 0' }}><dt>Contract</dt><dd>{s.number} · {s.supplier}</dd><dt>Validity</dt><dd>{dmy(s.validFrom)} to {dmy(s.validTo)}</dd><dt>Price basis</dt><dd>{s.netPrice == null ? 'Rate held on the ARC in SAP (not loaded in MonoSource)' : `${price(s.netPrice)} per ${s.uom}, excluding GST`}</dd><dt>Minimum order</dt><dd>{s.moq ? `${num(s.moq)} ${s.uom}` : 'None stated'}</dd><dt>Quantity cap</dt><dd>{s.qtyCap ? `${num(s.qtyCap)} · ${num(s.balance)} remaining` : 'None stated'}</dd>{can(me, 'contracts:read') && <><dt>Full contract</dt><dd><Link href={`/contracts/${s.contractId}`}>Open contract <Icon name="arrowRight" size={13} /></Link></dd></>}</dl>)}</details>}
      </section>}
    </div>

    {/* purchase bar — only when an order can be placed on contract */}
    {plant && src.case === 'A' && <div className="buybar" style={{ borderTop: '1px solid var(--bd)', background: '#fff', padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', bottom: 0, boxShadow: '0 -8px 20px -12px rgba(16,24,40,.18)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>{supply ? <><div className="mut" style={{ fontSize: 12 }}>{supply.supplier}</div><div style={{ fontWeight: 700, fontSize: 18 }}>{supply.netPrice == null ? <>{qty} {supply.uom} <span className="mut" style={{ fontWeight: 500, fontSize: 13 }}>· priced on the ARC in SAP</span></> : <>{inr(supply.netPrice * qty)} <span className="mut" style={{ fontWeight: 500, fontSize: 13 }}>({price(supply.netPrice)} × {qty})</span></>}</div></> : <div className="mut">Pick a supplier</div>}</div>
      <Qty value={qty} onChange={setQty} />
      <button className="btn" disabled={!supply || busy || qty < minOrder} onClick={() => add({ itemId: id, qty, contractLineId: supply.contractLineId }, `Added ${qty} × ${p.name}`)}><Icon name="cart" size={18} />Add to requirement</button>
      {supply && qty < minOrder && <span className="err" style={{ fontSize: 12 }}>Min {num(minOrder)}</span>}</div>}
    {supplier && <SupplierDrawer id={supplier} onClose={() => setSupplier(null)} />}
  </div>;
}
