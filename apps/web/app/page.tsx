'use client';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { can, useApp } from './shell';
import { GlobalSearch } from '../components/GlobalSearch';
import { Icon, categoryIcon } from '../components/Icon';
import { AuthImage } from '../components/AuthImage';
import { useOpenProduct } from '../components/ProductPanel';
import { useAddToCart, minQty } from '../components/ProductBits';
import { NonCatalogueDialog } from '../components/NonCatalogue';
import { pmPrice } from '../components/Source';
import { STATUS_LABEL, STATUS_TONE, ago, catLabel, price } from '../lib/format';

/** Two ways to buy: the group ARC, or ProcMart. Both are one click. */
const ARC = { tone: 'ok', label: 'On contract', price: '' };
const PM = { tone: 'pm', label: 'Via ProcMart', price: 'Price on quote' };
const ALERT_CTA: Record<string, string> = { draft: 'Review', late: 'View', attention: 'Open' };

function Pic({ imageId, category, alt }: { imageId?: string | null; category?: string | null; alt: string }) {
  return <AuthImage assetId={imageId} alt={alt} style={{ objectFit: 'cover' }} fallback={<span className="h-fallback"><Icon name={categoryIcon(category)} size={40} /></span>} />;
}

function ItemCard({ it, plant }: { it: any; plant: string }) {
  const { open } = useOpenProduct(); const add = useAddToCart(); const [busy, setBusy] = useState(false);
  const s = it.source; const arc = s?.case === 'A'; const c = arc ? ARC : PM; const quick = !!plant && !(arc && s.multiple);
  const go = async () => { if (!quick) return open(it.id); setBusy(true); await (arc ? add(it, minQty(it), s.supplies[0].contractLineId) : add(it, 1, undefined, { intent: 'source' })); setBusy(false); };
  return <article className="h-item">
    <a href={`/product/${it.id}`} className="h-item-pic" aria-label={`Open ${it.name}`} onClick={(e) => { e.preventDefault(); open(it.id); }}><Pic imageId={it.imageId} category={it.category} alt={it.name} /></a>
    <a href={`/product/${it.id}`} className="h-item-name" onClick={(e) => { e.preventDefault(); open(it.id); }}>{it.name}</a>
    <div className="h-sub">{[it.brand, it.mpn].filter(Boolean).join(' · ')}</div>
    <div className="h-price">{plant && s?.case === 'A' ? <>{s.multiple && <small>from </small>}{price(s.lowestPrice)}<small> / {it.uom}</small></> : plant && pmPrice(it) != null ? <>{price(pmPrice(it)!)}<small> / {it.uom}</small></> : <span className="h-price-q">{plant ? c.price : 'Pick a plant for price'}</span>}</div>
    {plant && <span className={`h-pill ${c.tone}`}>{c.label}</span>}
    <button className={`h-btn ${quick && arc ? 'pri' : ''} ${busy ? 'busy' : ''}`} disabled={busy} onClick={go}>{!plant ? 'View item' : quick ? 'Add to requirement' : 'Compare suppliers'}</button>
  </article>;
}

export default function Home() {
  const { me, plant, plants, cart, openCart } = useApp();
  const [h, setH] = useState<any>(null); const [disc, setDisc] = useState<any>(null); const [nc, setNc] = useState(false);
  useEffect(() => { if (me && can(me, 'catalogue:read')) api(`/home${plant ? `?plantId=${plant}` : ''}`).then(setH).catch(() => {}); }, [me, plant, cart?.lines?.length]);
  useEffect(() => { if (me) api('/discover').then(setDisc).catch(() => {}); }, [me]);
  const cats = useMemo(() => (disc?.facets?.categories ?? []).slice(0, 8).map((c: any) => ({ ...c, img: (disc.items ?? []).find((i: any) => i.category === c.value && i.imageId)?.imageId })), [disc]);
  if (!me) return null;
  const first = me.name.split(' ')[0]; const plantName = plants.find((p) => p.id === plant)?.name;
  if (!can(me, 'catalogue:read')) return <div className="page"><h1>Hello, {first}</h1></div>;
  const popular: any[] = (h?.popular ?? []).slice(0, 4); const alerts: any[] = h?.alerts ?? [];
  const strips = alerts.map((a) => { const m = /^(\d+ \S+)(.*)$/.exec(String(a.text)); return { kind: a.kind as string, text: m ? <><b>{m[1]}</b>{m[2]}</> : a.text, href: a.href as string }; });

  return <div className="home">
    <section className="h-hero">
      <span className="h-orbs" aria-hidden><span className="h-orb a" /><span className="h-orb b" /><span className="h-orb c" /></span>
      <div className="h-hero-in">
        <h1>What do you need{plantName ? <> for <span className="nowrap">{plantName}</span></> : ''}?</h1>
        <p>{plantName ? 'Search any item. We’ll show if a contract covers it.' : 'Pick your plant at the top to see prices.'}</p>
        <Suspense fallback={<div className="sb" style={{ height: 64 }} />}><GlobalSearch variant="hero" /></Suspense>
        {plantName && <button type="button" className="h-new" onClick={() => setNc(true)}><Icon name="plus" size={15} />Item not listed? Request it</button>}
      </div>
    </section>

    {cats.length > 0 && <section className="h-sec">
      <div className="h-head"><h2>Browse categories</h2><Link href="/search" className="h-more">View all</Link></div>
      <div className="h-cats">{cats.map((c: any) => <Link key={c.value} className="h-cat" href={`/search?category=${encodeURIComponent(c.value)}`}>
        <span className="h-cat-pic"><Pic imageId={c.img} category={c.value} alt="" /></span><b>{catLabel(c.value)}</b><small>{c.count} items</small></Link>)}</div>
    </section>}

    {strips.length > 0 && <div className="h-strips">{strips.map((a, i) => <Link key={i} href={a.href} className={`h-strip ${a.kind === 'late' || a.kind === 'attention' ? 'alert' : ''}`} onClick={(e) => { if (a.href.includes('cart=1')) { e.preventDefault(); openCart(); } }}>
      {a.kind !== 'draft' && <i className="dot" aria-hidden />}<span>{a.text}</span><em>{ALERT_CTA[a.kind] ?? 'Open'}</em></Link>)}</div>}

    <section className="h-sec">
      <div className="h-head"><h2>Bought often{plantName ? ` at ${plantName}` : ''}</h2><Link href="/search" className="h-more">View all</Link></div>
      {!h ? <div className="h-items">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 420, borderRadius: 24 }} />)}</div>
        : popular.length ? <div className="h-items">{popular.map((it) => <ItemCard key={it.id} it={it} plant={plant} />)}</div>
        : <div className="h-empty">{plant ? 'Your plant’s regular items will show here.' : 'Pick a plant to see its regular items.'}</div>}
    </section>

    <div className="h-lists">
      <section className="h-list"><div className="h-head"><h2>Recent requirements</h2><Link href="/activity" className="h-link">All</Link></div>
        {h?.requirements?.length ? h.requirements.slice(0, 4).map((r: any) => <Link key={r.id} href={`/requirements/${r.id}`} className="h-row"><span><b>{r.number}</b><small>{r.lines} line{r.lines === 1 ? '' : 's'} · {ago(r.createdAt)}</small></span><span className={`h-st ${STATUS_TONE(r.status)}`}>{STATUS_LABEL[r.status] ?? r.status.replace('_', ' ')}</span></Link>)
          : <div className="h-none">Nothing raised yet.</div>}</section>
      <section className="h-list"><div className="h-head"><h2>Orders on the way</h2><Link href="/activity?tab=orders" className="h-link">All</Link></div>
        {h?.orders?.recent?.length ? h.orders.recent.slice(0, 4).map((o: any) => <Link key={o.id} href={`/orders/${o.id}`} className="h-row"><span><b>{o.po ?? o.requirement}</b><small>{o.supplier}</small></span><span className={`h-st ${STATUS_TONE(o.status)}`}>{STATUS_LABEL[o.status] ?? o.status}</span></Link>)
          : <div className="h-none">No orders on the way.</div>}</section>
    </div>
    {nc && <NonCatalogueDialog onClose={() => setNc(false)} />}
  </div>;
}
