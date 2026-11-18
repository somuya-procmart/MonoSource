'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app/shell';
import { Icon } from './Icon';
import { Thumb } from './Thumb';
import { SourceSummary, AltChip } from './Source';
import { useOpenProduct } from './ProductPanel';
import { dmy } from '../lib/format';

export function Heart({ item, onChange }: { item: { id: string; saved?: boolean }; onChange?: (v: boolean) => void }) {
  const { notify } = useApp(); const [on, setOn] = useState(!!item.saved);
  const toggle = async (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); const next = !on; setOn(next); try { await api(`/saved/${item.id}`, { method: next ? 'POST' : 'DELETE', body: next ? {} : undefined }); onChange?.(next); notify(next ? 'Saved for later' : 'Removed from saved items', { href: '/saved', label: 'View saved' }); } catch (x: any) { setOn(!next); notify(x.message, { error: true }); } };
  return <button className={`heart ${on ? 'on' : ''}`} aria-pressed={on} aria-label={on ? 'Remove from saved items' : 'Save item'} onClick={toggle}><Icon name="heart" size={17} /></button>;
}
export function Qty({ value, onChange, min = 1 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return <div className="qty"><button type="button" aria-label="Decrease" onClick={() => onChange(Math.max(min, value - 1))}><Icon name="minus" size={14} /></button><input type="number" min={min} value={value} aria-label="Quantity" onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))} /><button type="button" aria-label="Increase" onClick={() => onChange(value + 1)}><Icon name="plus" size={14} /></button></div>;
}
export function SpecChips({ specs, max = 4 }: { specs?: Record<string, string>; max?: number }) {
  const e = Object.entries(specs ?? {}).slice(0, max); if (!e.length) return null;
  return <div className="specs">{e.map(([k, v]) => <span key={k} className="spec"><b>{k}</b>{String(v)}</span>)}</div>;
}
export const minQty = (it: any) => Math.max(1, Number(it.source?.supplies?.[0]?.moq ?? 1));

export function useAddToCart() {
  const { plant, refreshCart, openCart, notify } = useApp();
  return async (it: { id: string; name: string }, qty: number, contractLineId?: string, extra: Record<string, any> = {}) => {
    try { await api('/cart/items', { body: { plantId: plant, itemId: it.id, qty, contractLineId, ...extra } }); await refreshCart(); notify(`Added ${qty} × ${it.name}`); openCart(); return true; }
    catch (e: any) { notify(e.message, { error: true }); return false; }
  };
}
const MATCH: Record<string, string> = { sap_description: 'SAP description', common_name: 'Common name', application: 'Application', supplier_code: 'Supplier code', contract_description: 'Contract description' };

/** Result row: identity · source of supply (the answer) · one primary action that depends on the case. Clicking opens the product panel. */
export function ProductRow({ it, plant, plantName, compare, onCompare, i = 0 }: { it: any; plant: string; plantName?: string; compare: boolean; onCompare: (v: boolean) => void; i?: number }) {
  const add = useAddToCart(); const { open } = useOpenProduct(); const [qty, setQty] = useState(minQty(it)); const s = it.source; const quick = !!plant && !(s?.case === 'A' && s.multiple); const addIt = () => s?.case === 'A' ? add(it, qty, s.supplies[0].contractLineId) : add(it, qty, undefined, { intent: 'source' });
  const cta = !plant ? ['View details', 'ghost'] : s?.case === 'A' ? (s.multiple ? ['Compare suppliers', 'pri'] : null) : null;
  return <article className="prow" style={{ animationDelay: `${Math.min(i, 10) * 25}ms`, cursor: 'pointer' }} onClick={(e) => { if ((e.target as HTMLElement).closest('button,a,input,label')) return; open(it.id); }}>
    <label className="cmp-pick" title={`Compare ${it.name}`}><input type="checkbox" checked={compare} onChange={(e) => onCompare(e.target.checked)} /><span>Compare</span></label>
    <a href={`/product/${it.id}`} className="pthumb" aria-label={`Open ${it.name}`} onClick={(e) => { e.preventDefault(); open(it.id); }}><Thumb imageId={it.imageId} category={it.category} size={92} /></a>
    <div style={{ minWidth: 0 }}><a href={`/product/${it.id}`} className="pname" onClick={(e) => { e.preventDefault(); open(it.id); }}>{it.name}</a>
      <div className="psub">{[it.brand, it.mpn].filter(Boolean).join(' · ')}{it.codes?.length > 0 && ` · Code ${it.codes[0].code}`}</div>
      {it.matchedOn && <div style={{ marginTop: 4 }}><span className="tag pri" title={it.matchedOn.value}><Icon name="search" size={12} />Matched on {MATCH[it.matchedOn.kind] ?? it.matchedOn.kind}: <b style={{ fontWeight: 600 }}>{it.matchedOn.value}</b>{it.matchedOn.supplier ? ` · ${it.matchedOn.supplier}` : ''}</span></div>}
      <SpecChips specs={it.specs} max={3} /><AltChip s={s} /></div>
    <div className="supplycol"><SourceSummary it={it} plant={!!plant} plantName={plantName} /></div>
    <div className="actcol" style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
      <div className="row" style={{ marginBottom: 0, flexWrap: 'nowrap' }}><Heart item={it} />{quick && <Qty value={qty} onChange={setQty} />}</div>
      {quick ? <button className="btn sm" style={{ width: '100%' }} onClick={addIt}><Icon name="cart" size={16} />Add</button>
        : cta && <button className={`btn sm ${cta[1]}`} style={{ width: '100%' }} onClick={() => open(it.id)}>{cta[0]}</button>}
    </div></article>;
}

export function ProductCard({ it, plant, plantName, i = 0 }: { it: any; plant: string; plantName?: string; i?: number }) {
  const add = useAddToCart(); const { open } = useOpenProduct(); const [qty, setQty] = useState(minQty(it)); const s = it.source; const quick = !!plant && !(s?.case === 'A' && s.multiple); const addIt = () => s?.case === 'A' ? add(it, qty, s.supplies[0].contractLineId) : add(it, qty, undefined, { intent: 'source' });
  return <article className="pc" style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}>
    <a href={`/product/${it.id}`} className="pimg" aria-label={`Open ${it.name}`} onClick={(e) => { e.preventDefault(); open(it.id); }}><span className="cat">{it.category ?? 'Item'}</span><Thumb imageId={it.imageId} category={it.category} size={150} /></a>
    <div><a href={`/product/${it.id}`} className="nm" style={{ color: 'inherit' }} onClick={(e) => { e.preventDefault(); open(it.id); }}>{it.name}</a><div className="sub">{[it.brand, it.mpn].filter(Boolean).join(' · ')}</div></div>
    <SourceSummary it={it} plant={!!plant} plantName={plantName} />
    <div className="row" style={{ marginTop: 'auto', marginBottom: 0, flexWrap: 'nowrap' }}><Heart item={it} />
      {quick ? <><Qty value={qty} onChange={setQty} /><button className="btn sm" style={{ flex: 1 }} onClick={addIt}>Add</button></> : <button className="btn sm ghost" style={{ flex: 1 }} onClick={() => open(it.id)}>{plant ? 'Compare suppliers' : 'View details'}</button>}</div></article>;
}
export { dmy };
