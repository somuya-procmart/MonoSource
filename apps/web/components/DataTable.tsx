'use client';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Icon, IconName } from './Icon';

/**
 * The one data table. Sortable columns (click a header; aria-sort says the state), an optional "Find" filter, pagination,
 * loading rows, and two different empty states: "nothing here yet" and "nothing matches what you typed".
 * Numbers: pass `num` to right-align and use tabular figures.
 */
export interface Col<T> {
  key: string; label: string; render?: (r: T) => ReactNode; sort?: (r: T) => string | number | null | undefined;
  num?: boolean; width?: number | string; hideBelow?: 'md' | 'lg'; title?: string;
}
interface Props<T> {
  rows: T[] | null; cols: Col<T>[]; rowKey: (r: T) => string; label: string;
  search?: (r: T) => string; searchPlaceholder?: string; pageSize?: number; initialSort?: { key: string; dir: 'asc' | 'desc' };
  empty: { icon?: IconName; title: string; text?: ReactNode; action?: ReactNode };
  onRowClick?: (r: T) => void; toolbar?: ReactNode; dense?: boolean; flush?: boolean; rowClass?: (r: T) => string | undefined; /** on phones show each row as a label/value card (default) */ stack?: boolean;
}

export function DataTable<T>({ rows, cols, rowKey, label, search, searchPlaceholder = 'Type to filter', pageSize = 25, initialSort, empty, onRowClick, toolbar, dense, flush = true, rowClass, stack = true }: Props<T>) {
  const [q, setQ] = useState(''); const [sort, setSort] = useState(initialSort ?? null); const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [q, sort, rows?.length]);
  const view = useMemo(() => {
    let r = rows ?? [];
    if (search && q.trim()) { const t = q.trim().toLowerCase(); r = r.filter((x) => search(x).toLowerCase().includes(t)); }
    const c = sort && cols.find((x) => x.key === sort.key);
    if (c?.sort) { const k = c.sort; r = [...r].sort((a, b) => { const x = k(a), y = k(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; const v = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true }); return sort!.dir === 'asc' ? v : -v; }); }
    return r;
  }, [rows, q, sort, cols, search]);
  const pages = Math.max(1, Math.ceil(view.length / pageSize)); const cur = Math.min(page, pages - 1);
  const shown = view.slice(cur * pageSize, cur * pageSize + pageSize);
  const toggle = (c: Col<T>) => { if (!c.sort) return; setSort((s) => s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.num ? 'desc' : 'asc' }); };
  const hasTools = !!search || !!toolbar;
  return <div className={`dt ${flush ? 'card flush' : ''} ${dense ? 'dense' : ''} ${stack ? 'stack' : ''}`}>
    {hasTools && <div className="dt-tools">
      {search && <label className="field inline"><span>Find</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} /></label>}
      {toolbar}<span className="dt-count">{rows ? (q.trim() ? `${view.length} of ${rows.length}` : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`) : ''}</span></div>}
    <div className="tscroll"><table aria-label={label}><thead><tr>{cols.map((c) => { const on = sort?.key === c.key;
      return <th key={c.key} className={`${c.num ? 'num' : ''} ${c.hideBelow ? 'hide-' + c.hideBelow : ''}`} style={c.width ? { width: c.width } : undefined} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sort ? 'none' : undefined} title={c.title}>
        {c.sort ? <button type="button" className="th-sort" onClick={() => toggle(c)}>{c.label}<Icon name={on ? (sort!.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'sort'} size={12} /></button> : c.label}</th>; })}</tr></thead>
      <tbody>{!rows ? [0, 1, 2, 3].map((i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={c.hideBelow ? 'hide-' + c.hideBelow : ''}><div className="skel" style={{ height: 14, width: c.num ? 48 : '70%', marginLeft: c.num ? 'auto' : 0 }} /></td>)}</tr>)
        : shown.map((r) => <tr key={rowKey(r)} className={`${onRowClick ? 'clickable' : ''} ${rowClass?.(r) ?? ''}`} onClick={onRowClick ? (e) => { if ((e.target as HTMLElement).closest('a,button,input,select,label')) return; onRowClick(r); } : undefined}>
          {cols.map((c) => <td key={c.key} data-label={c.label || undefined} className={`${c.num ? 'num' : ''} ${c.hideBelow ? 'hide-' + c.hideBelow : ''}`}><span className="dt-v">{c.render ? c.render(r) : String((r as any)[c.key] ?? '—')}</span></td>)}</tr>)}
        {rows && !view.length && <tr><td colSpan={cols.length}>{rows.length && q.trim()
          ? <div className="empty"><div className="eic"><Icon name="search" size={20} /></div><b>Nothing matches “{q.trim()}”</b><p>Check the spelling or search for something shorter.</p><div className="acts"><button className="sec sm" onClick={() => setQ('')}>Clear the filter</button></div></div>
          : <div className="empty"><div className="eic"><Icon name={empty.icon ?? 'inbox'} size={20} /></div><b>{empty.title}</b>{empty.text && <p>{empty.text}</p>}{empty.action && <div className="acts">{empty.action}</div>}</div>}</td></tr>}</tbody></table></div>
    {rows && view.length > pageSize && <nav className="dt-pager" aria-label={`${label} pages`}>
      <span className="mut small">Showing {cur * pageSize + 1}–{Math.min(view.length, (cur + 1) * pageSize)} of {view.length}</span>
      <span className="row" style={{ margin: 0, gap: 4 }}><button className="sec sm" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Previous page"><Icon name="chevronLeft" size={14} />Previous</button>
        <span className="small" aria-live="polite" style={{ padding: '0 8px' }}>Page {cur + 1} of {pages}</span>
        <button className="sec sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Next page">Next<Icon name="chevronRight" size={14} /></button></span></nav>}
  </div>;
}
