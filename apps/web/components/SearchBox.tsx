'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { Icon } from './Icon';

const KEY = 'ms_recent';
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const writeRecent = (a: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* storage unavailable */ } };

/** Search with recent searches and live item suggestions (real catalogue data). Used on the home page and in the header. */
export function SearchBox({ plant, variant, initial = '' }: { plant: string; variant: 'hero' | 'bar'; initial?: string }) {
  const router = useRouter(); const [q, setQ] = useState(initial); const [open, setOpen] = useState(false);
  const [sugg, setSugg] = useState<any[]>([]); const [recent, setRecent] = useState<string[]>([]); const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setRecent(readRecent()); }, [open]);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setSugg([]); return; }
    const t = setTimeout(() => api(`/catalogue/search?q=${encodeURIComponent(q.trim())}`).then((r: any[]) => setSugg(r.slice(0, 5))).catch(() => setSugg([])), 180);
    return () => clearTimeout(t);
  }, [q]);
  const go = (term: string) => {
    const t = term.trim(); setOpen(false);
    if (t) writeRecent([t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6));
    router.push(`/search?q=${encodeURIComponent(t)}`);
  };
  const rows = q.trim().length >= 2 && sugg.length ? sugg.map((s) => ({ kind: 'item' as const, text: s.name, s })) : recent.map((r) => ({ kind: 'recent' as const, text: r, s: null }));
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, -1)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') { e.preventDefault(); go(hi >= 0 ? rows[hi].text : q); }
  };
  return (
    <div className={`sb sb-${variant}`} ref={box}>
      <div className="sb-field">
        <Icon name="search" size={variant === 'hero' ? 22 : 18} className="sb-lead" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(-1); }} onFocus={() => setOpen(true)} onKeyDown={key} role="combobox" aria-expanded={open} aria-label="Search the catalogue"
          placeholder={variant === 'hero' ? 'Search by item, brand, part number, spec or material code' : 'Search items, brands, material codes'} autoComplete="off" />
        {q && <button type="button" className="sb-clear" aria-label="Clear" onClick={() => { setQ(''); setSugg([]); }}><Icon name="x" size={16} /></button>}
        <button type="button" className="sb-go" onClick={() => go(q)}>Search</button>
      </div>
      {open && rows.length > 0 && <div className="sb-pop" role="listbox">
        <div className="sb-head">{rows[0].kind === 'item' ? 'Matching items' : <><span>Recent searches</span><button type="button" onClick={() => { writeRecent([]); setRecent([]); }}>Clear</button></>}</div>
        {rows.map((r, i) => <div key={r.kind + r.text} role="option" aria-selected={hi === i} className={`sb-row ${hi === i ? 'on' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); go(r.text); }}>
          <Icon name={r.kind === 'item' ? 'package' : 'history'} size={16} className="sb-ri" />
          <span className="sb-t">{r.text}</span>{r.s && <span className="sb-m">{[r.s.brand, r.s.mpn, r.s.codes?.[0]?.code].filter(Boolean).join(' · ')}</span>}</div>)}
      </div>}
    </div>
  );
}
