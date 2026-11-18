'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { useApp } from '../shell';
import { Thumb } from '../../components/Thumb';
import { Icon } from '../../components/Icon';
import { SourceBadge } from '../../components/Source';
import { dmy, price } from '../../lib/format';

function Compare() {
  const ids = (useSearchParams().get('ids') ?? '').split(',').filter(Boolean).slice(0, 4); const { plant } = useApp(); const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { Promise.all(ids.map((id) => api(`/products/${id}${plant ? `?plantId=${plant}` : ''}`))).then(setItems).catch(() => setItems([])); /* eslint-disable-next-line */ }, [ids.join(','), plant]);
  if (!items) return <div className="skel" style={{ height: 320 }} />;
  const keys = [...new Set(items.flatMap((i) => Object.keys(i.specs ?? {})))];
  const lowest = (i: any) => { const s = (i.source?.supplies ?? []).filter((x: any) => x.orderable !== false); return s.length ? s.reduce((a: any, b: any) => (a.netPrice <= b.netPrice ? a : b)) : null; };
  const best = Math.min(...items.map((i) => lowest(i)?.netPrice ?? Infinity));
  const Row = ({ label, cell }: { label: string; cell: (i: any) => React.ReactNode }) => <tr><th style={{ width: 190, background: 'var(--surface2)', textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>{label}</th>{items.map((i) => <td key={i.id}>{cell(i)}</td>)}</tr>;
  return <><div className="crumbs"><Link href="/search?q=">Discover</Link>›<b>Compare</b></div><div className="pagehead"><div><h1>Compare products</h1><p>Specifications and current contract supply side by side{plant ? ' for your plant' : ''}.</p></div><Link href="/search?q=" className="btn ghost sm"><Icon name="chevronLeft" size={16} />Back to results</Link></div>
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}><table style={{ minWidth: 640 }}><thead><tr><th style={{ background: '#fff' }} />{items.map((i) => <th key={i.id} style={{ background: '#fff', textTransform: 'none', letterSpacing: 0, verticalAlign: 'top', padding: 16 }}><div className="pthumb" style={{ width: '100%', height: 130, marginBottom: 10 }}><Thumb imageId={i.assets?.find((a: any) => a.kind === 'image')?.id} category={i.category} size={130} /></div><Link href={`/product/${i.id}`} className="pname" style={{ fontSize: 15 }}>{i.name}</Link><div className="psub" style={{ fontWeight: 400 }}>{[i.brand, i.mpn].filter(Boolean).join(' · ')}</div></th>)}</tr></thead>
      <tbody>
        <Row label="Contract price (lowest)" cell={(i) => { const l = lowest(i); return l ? <div><span className="price" style={{ fontSize: 20 }}>{price(l.netPrice)}</span><span className="mut"> / {i.uom}</span>{l.netPrice === best && items.length > 1 && <span className="tag ok" style={{ marginLeft: 8 }}>Lowest</span>}</div> : <span className="mut">No current contract</span>; }} />
        <Row label="Suppliers on contract" cell={(i) => i.source?.supplies?.filter((s: any) => s.orderable !== false).map((s: any) => <div key={s.contractLineId}>{s.supplier} <span className="mut">· {price(s.netPrice)}</span></div>) || '—'} />
        <Row label="Contract valid until" cell={(i) => { const l = lowest(i); return l ? dmy(l.validTo) : '—'; }} />
        <Row label="Minimum order" cell={(i) => { const l = lowest(i); return l?.moq ? `${l.moq} ${i.uom}` : '—'; }} />
        <Row label="Source of supply" cell={(i) => plant ? <SourceBadge src={i.source} plant compact /> : <span className="mut">Select plant</span>} />
        <tr><th colSpan={items.length + 1} style={{ background: '#fff', paddingTop: 22, color: 'var(--fg)', fontSize: 14, textTransform: 'none', letterSpacing: 0 }}>Specifications</th></tr>
        <Row label="Unit of measure" cell={(i) => i.uom} /><Row label="Category" cell={(i) => <span style={{ textTransform: 'capitalize' }}>{i.category}</span>} />
        {keys.map((k) => { const vals = items.map((i) => i.specs?.[k]); const differs = new Set(vals.map((v) => v ?? '—')).size > 1; return <tr key={k}><th style={{ width: 190, background: 'var(--surface2)', textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>{i0(items, k)}</th>{items.map((i) => <td key={i.id} style={differs ? { background: '#fffdf5' } : undefined}>{i.specs?.[k] ?? <span className="mut">Not recorded</span>}</td>)}</tr>; })}
        <Row label="" cell={(i) => <Link href={`/product/${i.id}`} className="btn sm pri">View product</Link>} />
      </tbody></table></div>
    <p className="mut" style={{ fontSize: 13 }}>Highlighted rows differ between the selected products.</p></>;
}
const i0 = (items: any[], k: string) => items.map((i) => i.attributes?.find((a: any) => a.key === k)?.label).find(Boolean) ?? k.replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export default function ComparePage() { return <Suspense><Compare /></Suspense>; }
