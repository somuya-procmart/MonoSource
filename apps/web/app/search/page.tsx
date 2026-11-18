'use client';
import { catLabel } from '../../lib/format';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { useApp } from '../shell';
import { Icon } from '../../components/Icon';
import { Thumb } from '../../components/Thumb';
import { ProductCard, ProductRow } from '../../components/ProductBits';
import { NonCatalogueDialog } from '../../components/NonCatalogue';

const FILTERS = [{ key: 'category', label: 'Category', facet: 'categories' }, { key: 'brand', label: 'Brand', facet: 'brands' }, { key: 'supplier', label: 'Supplier on contract', facet: 'suppliers' }, { key: 'uom', label: 'Unit of measure', facet: 'uoms' }];
const CASE_LABEL: Record<string, string> = { A: 'On contract', B: 'Via ProcMart', D: 'Via ProcMart', E: 'Via ProcMart' };

function FacetGroup({ f, facets, active, toggle }: { f: typeof FILTERS[number]; facets: any; active: string[]; toggle: (k: string, v: string) => void }) {
  const [more, setMore] = useState(false); const list: { value: string; count: number }[] = facets?.[f.facet] ?? [];
  if (list.length < 2 && !active.length) return null; const shown = more ? list : list.slice(0, 6);
  return <div className="fgroup"><h2 className="fg-t">{f.label}{active.length > 0 && <span className="tag pri">{active.length}</span>}</h2>
    {shown.map((o) => <label key={o.value} className="fopt"><input type="checkbox" checked={active.includes(o.value)} onChange={() => toggle(f.key, o.value)} /><span>{f.key === 'category' ? catLabel(o.value) : o.value}</span><span className="c">{o.count}</span></label>)}
    {list.length > 6 && <button className="sec sm" style={{ marginTop: 6 }} onClick={() => setMore(!more)}>{more ? 'Show less' : `Show ${list.length - 6} more`}</button>}</div>;
}

function Results() {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams(); const { plant, plants } = useApp();
  const q = sp.get('q') ?? ''; const ask = sp.get('ask') ?? ''; const sort = sp.get('sort') ?? 'relevance'; const view = sp.get('view') ?? 'list'; const cases = (sp.get('case') ?? '').split(',').filter(Boolean);
  const sel = (k: string) => (sp.get(k) ?? '').split(',').filter(Boolean);
  const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(true); const [cmp, setCmp] = useState<any[]>([]); const [showFilters, setShowFilters] = useState(false); const [nc, setNc] = useState(false);
  const qs = useMemo(() => { const p = new URLSearchParams(sp.toString()); p.delete('view'); p.delete('open'); if (plant) p.set('plantId', plant); return p.toString(); }, [sp, plant]);
  useEffect(() => { setLoading(true); api(`/discover?${qs}`).then((r) => { setData(r); setLoading(false); }).catch(() => { setData({ total: 0, items: [], facets: {} }); setLoading(false); }); }, [qs]);
  const set = useCallback((patch: Record<string, string | null>) => { const p = new URLSearchParams(sp.toString()); for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k); router.replace(`${path}?${p.toString()}`, { scroll: false }); }, [sp, router, path]);
  const toggle = (k: string, v: string) => { const cur = sel(k); set({ [k]: (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]).join(',') || null }); };
  const toggleCase = (c: string) => set({ case: (cases.includes(c) ? cases.filter((x) => x !== c) : [...cases, c]).join(',') || null });
  const applied = [...FILTERS.flatMap((f) => sel(f.key).map((v) => ({ k: f.key, v, label: `${f.label.split(' ')[0]}: ${v}` }))), ...cases.map((c) => ({ k: 'case', v: c, label: CASE_LABEL[c] }))];
  const items: any[] = data?.items ?? []; const f = data?.facets; const plantName = plants.find((p) => p.id === plant)?.name;
  const toggleCompare = (it: any, on: boolean) => setCmp((c) => on ? (c.length >= 4 ? c : [...c.filter((x) => x.id !== it.id), it]) : c.filter((x) => x.id !== it.id));
  const clear = () => set({ category: null, brand: null, supplier: null, uom: null, coverage: null, case: null });
  const title = ask ? 'Matches from Ask MonoSource' : q ? `Results for “${q}”` : sel('category').length === 1 ? sel('category')[0] : 'All products';
  const noResult = !loading && !items.length;
  return <>
    <div className="crumbs"><Link href="/">Buy</Link>›<b>{ask ? 'Ask MonoSource' : 'Search'}</b></div>
    <div className="pagehead"><div><h1 style={{ textTransform: sel('category').length === 1 && !q && !ask ? 'capitalize' : undefined }}>{title}</h1><p>{loading ? 'Searching…' : `${data?.total ?? 0} item${data?.total === 1 ? '' : 's'}`}{plantName ? ` · source of supply for ${plantName}` : ''}</p></div></div>
    {!plant && <div className="banner"><Icon name="pin" size={18} /><span>Select your plant (top right) so MonoSource can tell you whether each item is on a contract you can use.</span></div>}
    {ask && <div className="banner info" style={{ alignItems: 'center' }}><Icon name="sparkles" size={18} /><span>Narrowed by Ask MonoSource: “{ask}”</span><button className="sec" style={{ marginLeft: 'auto', height: 30 }} onClick={() => set({ ask: null, ids: null })}>Show all products</button></div>}

    {plant && f?.cases && !noResult && <div className="row" style={{ gap: 8, marginBottom: 14 }}>{f.cases.filter((c: any) => c.count > 0).map((c: any) => <span key={c.value} className={`chip ${cases.includes(c.value) ? 'on' : ''}`} role="button" tabIndex={0} onClick={() => toggleCase(c.value)}>{CASE_LABEL[c.value]}<small style={{ opacity: .7 }}>{c.count}</small></span>)}{applied.length > 0 && <button className="sec" style={{ height: 32 }} onClick={clear}>Clear all</button>}</div>}

    <div className="results">
      <aside className="filters" style={{ display: showFilters || (typeof window !== 'undefined' && window.innerWidth > 900) ? undefined : 'none' }}>
        {FILTERS.map((x) => <FacetGroup key={x.key} f={x} facets={f} active={sel(x.key)} toggle={toggle} />)}
        <div className="fgroup"><h2 className="fg-t">Can’t find it?</h2><button className="sec sm" style={{ width: '100%' }} onClick={() => setNc(true)}><Icon name="edit" size={15} />Request a new item</button></div>
      </aside>
      <div>
        <div className="toolbar">
          <button className="sec" id="filter-toggle" style={{ display: 'none' }} onClick={() => setShowFilters(!showFilters)}><Icon name="sliders" size={16} />Filters</button>
          {applied.map((a) => <span key={a.k + a.v} className="fchip">{a.label}<button aria-label={`Remove ${a.label}`} onClick={() => a.k === 'case' ? toggleCase(a.v) : toggle(a.k, a.v)}><Icon name="x" size={12} /></button></span>)}
          <span style={{ marginLeft: 'auto' }} /><label className="row" style={{ marginBottom: 0, gap: 6 }}><span className="mut" style={{ fontSize: 13 }}>Sort</span><select value={sort} onChange={(e) => set({ sort: e.target.value === 'relevance' ? null : e.target.value })} style={{ height: 36 }}><option value="relevance">Best match</option><option value="price_asc">Contract price: low to high</option><option value="price_desc">Contract price: high to low</option><option value="name">Name A–Z</option></select></label>
          <div className="seg" role="group" aria-label="View"><button className={view === 'list' ? 'on' : ''} onClick={() => set({ view: null })} aria-label="List view"><Icon name="list2" size={16} /></button><button className={view === 'grid' ? 'on' : ''} onClick={() => set({ view: 'grid' })} aria-label="Grid view"><Icon name="grid" size={16} /></button></div></div>

        {loading && !data ? <div style={{ display: 'grid', gap: 12 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 124 }} />)}</div>
          : noResult ? <div className="card" style={{ textAlign: 'center', padding: '36px 24px' }}>
              <div className="eic" style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--pri-soft)', color: 'var(--pri)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><Icon name="search" size={24} /></div>
              <h2 style={{ marginBottom: 16 }}>Not in the catalogue</h2>
              <button className="btn lg pri" onClick={() => setNc(true)}><Icon name="plus" size={18} />{q ? `Request “${q}”` : 'Request a new item'}</button>
              {applied.length > 0 && <div style={{ marginTop: 16 }}><button className="sec" onClick={clear}>Clear filters</button></div>}</div>
          : view === 'grid' ? <div className="grid4" style={{ opacity: loading ? .6 : 1, transition: 'opacity .2s' }}>{items.map((it, i) => <ProductCard key={it.id} it={it} plant={plant} plantName={plantName} i={i} />)}</div>
          : <div className="plist" style={{ opacity: loading ? .6 : 1, transition: 'opacity .2s' }}>{items.map((it, i) => <ProductRow key={it.id} it={it} plant={plant} plantName={plantName} i={i} compare={cmp.some((c) => c.id === it.id)} onCompare={(v) => toggleCompare(it, v)} />)}
              <div className="mut" style={{ textAlign: 'center', padding: '12px 0', fontSize: 13 }}>Not what you’re looking for? <button className="sec sm" style={{ marginLeft: 6 }} onClick={() => setNc(true)}>Request a new item</button></div></div>}
      </div>
    </div>
    {cmp.length > 0 && <div className="compare-tray" role="region" aria-label="Compare tray"><div className="row" style={{ marginBottom: 0, gap: 8 }}>{cmp.map((c) => <div key={c.id} className="th" title={c.name}><Thumb imageId={c.imageId} category={c.category} size={40} /></div>)}</div><span style={{ fontSize: 13 }}>{cmp.length} of 4 selected</span>
      <Link href={`/compare?ids=${cmp.map((c) => c.id).join(',')}`} className="btn sm" style={{ pointerEvents: cmp.length > 1 ? 'auto' : 'none', opacity: cmp.length > 1 ? 1 : .5 }}>Compare</Link><button className="icon" style={{ background: 'transparent', border: 0, boxShadow: 'none' }} aria-label="Clear comparison" onClick={() => setCmp([])}><Icon name="x" size={16} /></button></div>}
    {nc && <NonCatalogueDialog initial={q} onClose={() => setNc(false)} />}
    <style>{`@media(max-width:900px){#filter-toggle{display:inline-flex!important}}`}</style>
  </>;
}
export default function Search() { return <Suspense><Results /></Suspense>; }
