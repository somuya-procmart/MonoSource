'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../lib/api';
import { useApp } from '../app/shell';
import { Icon, categoryIcon } from './Icon';
import { Thumb } from './Thumb';
import { useOpenProduct } from './ProductPanel';
import { NonCatalogueDialog } from './NonCatalogue';
import { price, catLabel } from '../lib/format';

const KEY = 'ms_recent';
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const writeRecent = (a: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* storage unavailable */ } };
let catCache: string[] | null = null;

interface AskState { text: string; answers: Record<string, string>; skipped: string[]; res: any; busy: boolean }
const EMPTY: AskState = { text: '', answers: {}, skipped: [], res: null, busy: false };

/**
 * One search for the whole app. Two modes share the same bar: Products (catalogue search with suggestions)
 * and Ask MonoSource (describe a need; it asks for missing details inline and hands the matches to the results page).
 */
export function GlobalSearch({ variant }: { variant: 'bar' | 'hero' }) {
  const { open: openProduct } = useOpenProduct();
  const router = useRouter(); const sp = useSearchParams(); const { plant } = useApp();
  const [mode, setMode] = useState<'products' | 'ask'>('products'); const [q, setQ] = useState(sp.get('q') ?? '');
  const [open, setOpen] = useState(false); const [hi, setHi] = useState(-1);
  const [sugg, setSugg] = useState<any[]>([]); const [recent, setRecent] = useState<string[]>([]); const [cats, setCats] = useState<string[]>(catCache ?? []);
  const [nc, setNc] = useState<string | null>(null); const [looking, setLooking] = useState(false); const [ask, setAsk] = useState<AskState>(EMPTY); const [step, setStep] = useState(0);
  const box = useRef<HTMLDivElement>(null); const modesRef = useRef<HTMLDivElement>(null); const [pill, setPill] = useState({ x: 0, w: 0 }); const seq = useRef(0);

  useLayoutEffect(() => { const el = modesRef.current?.querySelector<HTMLElement>(`[data-mode="${mode}"]`); if (el) setPill({ x: el.offsetLeft - 3, w: el.offsetWidth }); }, [mode, variant]);
  useEffect(() => { setRecent(readRecent()); }, [open]);
  useEffect(() => { if (!catCache) api('/discover').then((r) => { catCache = r.facets.categories.map((c: any) => c.value); setCats(catCache!); }).catch(() => {}); }, []);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useEffect(() => { // live suggestions in Products mode
    if (mode !== 'products' || q.trim().length < 2) { setSugg([]); setLooking(false); return; }
    setLooking(true);
    const t = setTimeout(() => api(`/catalogue/search?q=${encodeURIComponent(q.trim())}${plant ? `&plantId=${plant}` : ''}`).then((r: any[]) => setSugg(r.slice(0, 5))).catch(() => setSugg([])).finally(() => setLooking(false)), 160);
    return () => clearTimeout(t);
  }, [q, mode, plant]);
  useEffect(() => { if (!ask.busy) { setStep(0); return; } const a = setTimeout(() => setStep(1), 450), b = setTimeout(() => setStep(2), 950); return () => { clearTimeout(a); clearTimeout(b); }; }, [ask.busy]);

  const remember = (t: string) => writeRecent([t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6));
  const goProducts = (term: string, extra = '') => { const t = term.trim(); setOpen(false); if (t) remember(t); router.push(`/search?q=${encodeURIComponent(t)}${extra}`); };
  const runAsk = useCallback(async (text: string, answers: Record<string, string>, skipped: string[]) => {
    const my = ++seq.current; setAsk({ text, answers, skipped, res: null, busy: true }); setOpen(true);
    try { const [res] = await Promise.all([api('/ask', { body: { text, plantId: plant || undefined, answers, skipped } }), Promise.resolve()]); if (my === seq.current) setAsk({ text, answers, skipped, res, busy: false }); }
    catch { if (my === seq.current) setAsk({ text, answers, skipped, res: { message: 'Something went wrong. Try again.', candidates: [], total: 0 }, busy: false }); }
  }, [plant]);
  const goAsk = (t: string) => { const v = t.trim(); if (!v) return; remember(v); setOpen(false); try { sessionStorage.removeItem('ms_ask'); } catch { /* ignore */ } router.push(`/ask?q=${encodeURIComponent(v)}`); };
  const submit = () => { if (mode === 'ask') goAsk(q); else goProducts(q); };
  const answer = (key: string, value: string) => runAsk(ask.text, { ...ask.answers, [key]: value }, ask.skipped);
  const seeAll = () => { const r = ask.res; setOpen(false); router.push(`/search?ask=${encodeURIComponent(ask.text)}&ids=${(r?.matchingIds ?? []).join(',')}`); };
  const switchMode = (m: 'products' | 'ask') => { setMode(m); setHi(-1); setAsk(EMPTY); setOpen(true); (box.current?.querySelector('input') as HTMLInputElement | null)?.focus(); };

  const recentRows = recent.map((t) => ({ kind: 'recent' as const, text: t }));
  const typed = q.trim().length >= 2;
  const rows: { kind: 'item' | 'recent' | 'all' | 'new'; text: string; it?: any }[] = mode === 'products'
    ? (typed ? [...sugg.map((it) => ({ kind: 'item' as const, text: it.name, it })), ...(sugg.length ? [{ kind: 'all' as const, text: q.trim() }] : []), { kind: 'new' as const, text: q.trim() }] : recentRows) : [];
  const pick = (x: { kind: string; text: string; it?: any }) => { setOpen(false); if (x.kind === 'item') { remember(q.trim() || x.text); openProduct(x.it.id); } else if (x.kind === 'new') setNc(x.text); else goProducts(x.text); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, -1)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') { e.preventDefault(); const r = hi >= 0 ? rows[hi] : null; if (r) pick(r); else submit(); }
  };
  const r = ask.res; const answers = Object.entries((r?.answers ?? {}) as Record<string, { value: string; source: string; label?: string }>);
  const L = variant === 'hero';

  return (
    <div className={`sb ${mode === 'ask' ? 'ask' : ''} ${L ? 'sb-hero' : ''}`} ref={box}>
      <div className="sb-field" role="search">
        <div className="sb-modes" ref={modesRef} role="tablist" aria-label="Search mode">
          <span className="sb-pill" style={{ ['--x' as any]: `${pill.x}px`, ['--w' as any]: `${pill.w}px` }} />
          <button type="button" role="tab" aria-selected={mode === 'products'} aria-label="Search products" data-mode="products" className={`sb-mode ${mode === 'products' ? 'on' : ''}`} onClick={() => switchMode('products')}><Icon name="search" size={L ? 17 : 15} /><span className="t">Products</span></button>
          <button type="button" role="tab" aria-selected={mode === 'ask'} aria-label="Ask MonoSource" data-mode="ask" className={`sb-mode ai ${mode === 'ask' ? 'on' : ''}`} onClick={() => switchMode('ask')}><Icon name="sparkles" size={L ? 17 : 15} /><span className="t">Ask MonoSource</span></button>
        </div>
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(-1); }} onFocus={() => setOpen(true)} onKeyDown={key} role="combobox" aria-expanded={open} aria-label={mode === 'ask' ? 'Describe what you need' : 'Search the catalogue'} autoComplete="off"
          placeholder={mode === 'ask' ? 'Describe what you need, e.g. “sealed bearing for a 25 mm shaft”' : L ? 'Search by item, brand, part number, specification or material code' : 'Search items, brands, material codes'} />
        {q && <button type="button" className="sb-clear" aria-label="Clear" onClick={() => { setQ(''); setSugg([]); setAsk(EMPTY); }}><Icon name="x" size={16} /></button>}
        <button type="button" className="sb-go" onClick={submit}>{mode === 'ask' ? <><Icon name="sparkles" size={16} />Ask</> : 'Search'}</button>
      </div>

      {open && mode === 'products' && (rows.length > 0 || (!q.trim() && cats.length > 0)) && <div className="sb-pop" role="listbox">
        {rows.length > 0 && <div className="sb-head">{rows[0].kind === 'new' ? <span>{looking ? 'Searching…' : 'Not in the catalogue'}</span> : rows[0].kind === 'recent' ? <><span>Recent searches</span><button type="button" onClick={() => { writeRecent([]); setRecent([]); }}>Clear</button></> : <span>Matching items</span>}</div>}
        {rows.map((x, i) => <div key={x.kind + x.text + i} role="option" aria-selected={hi === i} className={`sb-row ${hi === i ? 'on' : ''}`} onMouseEnter={() => setHi(i)}
          onMouseDown={(e) => { e.preventDefault(); pick(x); }}>
          {x.kind === 'item' ? <div className="sb-th"><Thumb imageId={x.it.imageId} category={x.it.category} size={38} /></div> : <Icon name={x.kind === 'all' ? 'search' : x.kind === 'new' ? 'plus' : 'history'} size={16} className="sb-ri" />}
          <div style={{ minWidth: 0, flex: 1 }}><div className="sb-t">{x.kind === 'all' ? <>See all results for “{x.text}”</> : x.kind === 'new' ? <>Request “{x.text}” as a new item</> : x.text}</div>{x.it && <div className="sb-m">{[x.it.brand, x.it.mpn, x.it.codes?.[0]?.code && `Code ${x.it.codes[0].code}`].filter(Boolean).join(' · ')}</div>}</div>
          {x.it?.source?.lowestPrice != null && <b className="nowrap">{price(x.it.source.lowestPrice)}<span className="mut" style={{ fontWeight: 500 }}> / {x.it.uom}</span></b>}</div>)}
        {!q.trim() && cats.length > 0 && <><div className="sb-head"><span>Browse categories</span></div><div className="row" style={{ padding: '0 12px 8px', marginBottom: 0 }}>{cats.slice(0, 8).map((c) => <span key={c} className="chip" role="button" tabIndex={0} onMouseDown={(e) => { e.preventDefault(); setOpen(false); router.push(`/search?category=${encodeURIComponent(c)}`); }}><Icon name={categoryIcon(c)} size={14} />{catLabel(c)}</span>)}</div></>}
      </div>}

      {open && mode === 'ask' && <div className="sb-pop ask-panel">
        {!ask.text ? <div style={{ padding: '6px 4px 4px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600, marginBottom: 6 }}><Icon name="sparkles" size={18} style={{ color: '#6d3fd6' }} />Describe what you need</div>
          <div className="mut" style={{ fontSize: 13, marginBottom: 12 }}>Your request becomes a conversation: I’ll ask only what the catalogue can’t answer, then show matching items and how your plant can buy them.</div>
          <div className="row" style={{ marginBottom: 0 }}>{['I need 500 industrial bearings for a conveyor motor', 'Find the existing ARC for electrical cables at my plant', 'I need an industrial hose for high-pressure applications', 'Find an equivalent to this contactor'].map((s) => <button key={s} type="button" className="opt" onMouseDown={(e) => { e.preventDefault(); setQ(s); goAsk(s); }}>{s}</button>)}</div></div>
        : <>
          <div className="ask-you"><span className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>You</span><div className="bubble">{ask.text}</div></div>
          {ask.busy ? <div className="ask-think">{['Understanding your requirement', 'Matching products in your catalogue'].slice(0, step + 1).map((t, i) => <div key={t} className="step-line"><Icon name={i < step ? 'checkCircle' : 'sparkles'} size={15} style={{ color: i < step ? 'var(--ok)' : '#6d3fd6' }} />{t}{i === step && '…'}</div>)}
            <div className="skel" style={{ height: 54, marginTop: 6 }} /></div> : r && <>
            {answers.length > 0 && <div className="row" style={{ marginBottom: 12 }}><span className="mut" style={{ fontSize: 12, fontWeight: 600 }}>UNDERSTOOD</span>{answers.map(([k, a]) => <span key={k} className="fchip">{a.label ?? k}: {a.value}<button type="button" aria-label={`Remove ${k}`} onClick={() => { const n = { ...ask.answers }; delete n[k]; runAsk(ask.text, n, a.source === 'your text' ? [...ask.skipped, k] : ask.skipped); }}><Icon name="x" size={12} /></button></span>)}</div>}
            {r.question && !r.done && <div className="ask-q"><div style={{ fontWeight: 600, marginBottom: 2 }}>{r.question.label}?{r.question.required && <span className="tag warn" style={{ marginLeft: 8 }}>Needed</span>}</div>
              <div className="mut" style={{ fontSize: 13, marginBottom: 10 }}>{r.total} item{r.total === 1 ? '' : 's'} match so far.{r.question.unknownCount > 0 && ` ${r.question.unknownCount} don’t record this detail.`}</div>
              <div className="row" style={{ marginBottom: 0 }}>{r.question.options.map((o: any) => <button key={o.value} type="button" className="opt" onClick={() => answer(r.question.key, o.value)}>{o.label ?? o.value}<small>{o.count}</small></button>)}
                {!r.question.required && <button type="button" className="opt" style={{ borderStyle: 'dashed', color: 'var(--mut)' }} onClick={() => runAsk(ask.text, ask.answers, [...ask.skipped, r.question.key])}>Not sure</button>}</div></div>}
            {r.candidates.length > 0 ? <>
              <div className="sb-head" style={{ padding: '4px 2px 8px' }}><span>{r.done ? `Best matches · ${r.total}` : `Matches so far · ${r.total}`}</span></div>
              {r.candidates.slice(0, 3).map((c: any) => <Link key={c.id} href={`/product/${c.id}`} className="mini-match" onClick={(e) => { e.preventDefault(); setOpen(false); openProduct(c.id); }}><div className="sb-th" style={{ width: 52, height: 52 }}><Thumb imageId={c.imageId} category={c.category} size={52} /></div>
                <div style={{ flex: 1, minWidth: 0 }}><div className="sb-t" style={{ fontSize: 14 }}>{c.name}</div><div className="sb-m">{[c.brand, c.mpn].filter(Boolean).join(' · ')}</div></div>
                <div style={{ textAlign: 'right', flex: 'none' }}>{c.source?.lowestPrice != null ? <><b>{c.source.multiple ? 'from ' : ''}{price(c.source.lowestPrice)}</b></> : <span className="mut" style={{ fontSize: 13 }}>No contract price</span>}</div></Link>)}
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, marginBottom: 0 }}><button type="button" className="sec" onClick={() => setAsk(EMPTY)}>Start over</button>
                <button type="button" className="btn sm pri" onClick={seeAll}>See {r.total} matching product{r.total === 1 ? '' : 's'}<Icon name="arrowRight" size={16} /></button></div></>
            : <div className="mut" style={{ padding: '8px 2px' }}>{r.message ?? 'Nothing in the catalogue matches that.'}</div>}</>}
        </>}
      </div>}
      {nc !== null && <NonCatalogueDialog initial={nc} onClose={() => setNc(null)} />}
    </div>
  );
}
