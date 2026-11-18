'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app/shell';
import { Icon } from './Icon';
import { Thumb } from './Thumb';
import { NonCatalogueDialog } from './NonCatalogue';
import { Qty } from './ProductBits';
import { inr, price } from '../lib/format';

const GROUPS = [
  { id: 'arc', routes: ['arc', 'exception'], title: 'On contract', icon: 'checkCircle' as const, tone: 'ok' },
  { id: 'pm', routes: ['direct', 'sourcing'], title: 'Via ProcMart', icon: 'zap' as const, tone: 'pm' },
  { id: 'out', routes: ['returned', 'award'], title: 'Can’t order yet', icon: 'alert' as const, tone: 'bad' },
];

/** One drawer for the whole buying step: cart → submitted. How a line is bought is decided behind the scenes. */
export function CartDrawer({ onClose }: { onClose: () => void }) {
  const { cart, refreshCart, plants, plant, notify } = useApp(); const [step, setStep] = useState<'cart' | 'done'>('cart'); const [done, setDone] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null); const [nc, setNc] = useState(false);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', h); const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.removeEventListener('keydown', h); document.body.style.overflow = o; }; }, [onClose]);
  const lines: any[] = cart?.lines ?? []; const orderable = lines.filter((l) => ['arc', 'direct', 'sourcing', 'exception'].includes(l.routing.route));
  const total = lines.reduce((s, l) => s + (l.routing?.unitPrice ? l.routing.unitPrice * Number(l.qty) : 0), 0);
  const patch = async (l: any, body: any) => { setBusy(l.id); try { await api(`/cart/lines/${l.id}`, { body }); await refreshCart(); } catch (e: any) { notify(e.message, { error: true }); } setBusy(null); };
  const remove = async (l: any) => { setBusy(l.id); try { await api(`/cart/lines/${l.id}`, { method: 'DELETE' }); await refreshCart(); } catch (e: any) { notify(e.message, { error: true }); } setBusy(null); };
  const submit = async () => { setBusy('submit'); try { setDone(await api(`/cart/${cart.cartId}/submit`, { method: 'POST', body: {} })); setStep('done'); await refreshCart(); } catch (e: any) { notify(e.message, { error: true }); } setBusy(null); };
  return <>
    <div className="scrim" onClick={onClose} />
    <aside className="drawer" role="dialog" aria-label="Your requirement" style={{ width: 'min(580px,100vw)' }}>
      <div className="drawer-h"><div><h2 style={{ margin: 0 }}>{step === 'done' ? 'Requirement submitted' : 'Your requirement'}</h2>{step === 'cart' && <div className="mut" style={{ fontSize: 13 }}>{plants.find((p) => p.id === plant)?.name ?? 'Select a plant'} · {lines.length} item{lines.length === 1 ? '' : 's'}</div>}</div><button className="sec icon" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button></div>
      {step === 'done' ? <div className="drawer-b" style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}><div>
        <div style={{ width: 64, height: 64, borderRadius: 12, background: 'var(--ok-soft)', color: 'var(--ok)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}><Icon name="checkCircle" size={32} /></div>
        <h1>{done.number}</h1><p className="mut" style={{ maxWidth: 380 }}>{done.lines.some((l: any) => l.route === 'sourcing') ? 'ProcMart is getting quotes for you.' : 'Sent for approval.'}</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}><Link href={`/requirements/${done.requirementId}`} onClick={onClose} className="btn">Track this requirement</Link><button className="sec" onClick={onClose}>Close</button></div></div></div>
      : <>
        <div className="drawer-b">{!lines.length ? <div className="empty"><div className="eic"><Icon name="cart" size={24} /></div><b>Nothing added yet</b><div className="acts"><Link href="/" onClick={onClose} className="btn sec sm">Find an item</Link></div></div> :
          GROUPS.map((g) => { const ls = lines.filter((l) => g.routes.includes(l.routing.route)); if (!ls.length) return null;
            return <section key={g.id} style={{ margin: '14px 0 20px' }}><div className={`cart-group ${g.tone}`}><Icon name={g.icon} size={15} /><b>{g.title}</b><span>{ls.length}</span></div>
              {ls.map((l) => <div className="dline" key={l.id} style={{ opacity: busy === l.id ? .5 : 1, gridTemplateColumns: '56px 1fr' }}>
                <Link href={`/product/${l.item_id}`} onClick={onClose} className="dth" style={{ width: 56, height: 56 }}><Thumb imageId={l.image_id} category={l.category} size={56} /></Link>
                <div style={{ minWidth: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ fontWeight: 600 }}>{l.name}{l.item_source === 'requested' && <span className="tag" style={{ marginLeft: 6 }}>New item</span>}</span><b>{l.routing?.unitPrice != null ? inr(l.routing.unitPrice * Number(l.qty)) : <span className="mut" style={{ fontWeight: 500, fontSize: 12 }}>On quote</span>}</b></div>
                  <div className="mut" style={{ fontSize: 12 }}>{l.routing?.unitPrice != null ? `${price(l.routing.unitPrice)} / ${l.uom}` : l.uom}</div>
                  {g.id === 'out' && <div className="mut" style={{ fontSize: 12, marginTop: 4 }}>{typeof l.routing.trace.at(-1)?.detail === 'string' ? l.routing.trace.at(-1).detail : ''}</div>}
                  <div className="row" style={{ marginTop: 8, marginBottom: 0, gap: 10 }}><Qty value={Number(l.qty)} onChange={(n) => patch(l, { qty: n })} /><label className="row" style={{ marginBottom: 0, gap: 6 }}><span className="mut" style={{ fontSize: 12 }}>Need by</span><input type="date" style={{ height: 36, width: 150 }} value={l.need_by ?? ''} min={new Date().toISOString().slice(0, 10)} onChange={(e) => patch(l, { needBy: e.target.value })} /></label><button className="sec icon" aria-label={`Remove ${l.name}`} onClick={() => remove(l)} style={{ marginLeft: 'auto' }}><Icon name="trash" size={15} /></button></div></div></div>)}</section>; })}
          {plant && <button type="button" className="h-new" style={{ marginTop: lines.length ? 4 : 16 }} onClick={() => setNc(true)}><Icon name="plus" size={15} />Item not listed? Request it</button>}</div>
        <div className="drawer-f">
          <div className="sumtot" style={{ border: 0, margin: 0, paddingTop: 0 }}><span>Estimated total</span><b>{inr(total)}</b></div><div className="mut" style={{ fontSize: 12, marginBottom: 12 }}>Excl. GST. ProcMart items are priced on quote.</div>
          <div className="row" style={{ marginBottom: 0 }}><button className="sec" style={{ flex: 1 }} onClick={onClose}>Add more items</button><button className={`btn ${busy === 'submit' ? 'busy' : ''}`} style={{ flex: 1.5 }} disabled={!orderable.length || busy === 'submit'} onClick={submit}>{`Submit (${orderable.length})`}<Icon name="arrowRight" size={16} /></button></div></div></>}
    </aside>{nc && <NonCatalogueDialog onClose={() => setNc(false)} />}</>;
}
