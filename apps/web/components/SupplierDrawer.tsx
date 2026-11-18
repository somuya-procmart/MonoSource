'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { STATUS_LABEL, STATUS_TONE, dmy, inr } from '../lib/format';

/** Supplier information in context (opened from a product or a contract) — there is no separate suppliers module. */
export function SupplierDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [s, setS] = useState<any>(null); const [denied, setDenied] = useState(false);
  useEffect(() => { api(`/suppliers/${id}/overview`).then(setS).catch(() => setDenied(true)); }, [id]);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [onClose]);
  return <><div className="scrim" style={{ zIndex: 80 }} onClick={onClose} /><aside className="drawer" style={{ zIndex: 81, width: 'min(460px,100vw)' }} role="dialog" aria-label="Supplier">
    <div className="drawer-h"><h2 style={{ margin: 0 }}>Supplier</h2><button className="sec icon" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button></div>
    <div className="drawer-b" style={{ padding: 20 }}>{denied ? <div className="mut">Supplier performance and contact details are available to procurement users.</div> : !s ? <div className="skel" style={{ height: 160 }} /> : <>
      <h1 style={{ fontSize: 20 }}>{s.legalName} {s.isProcmart && <span className="tag pri">ProcMart</span>}</h1>
      <div className="mut" style={{ marginBottom: 12 }}>{s.contactEmail ?? 'No contact on file'}{s.contactPhone ? ` · ${s.contactPhone}` : ''}</div>
      <div className="row"><span className="tag ok" style={{ textTransform: 'capitalize' }}>{s.status}</span>{s.erpCodes.map((c: any) => <span key={c.server} className="tag">{c.vendorCode} · {c.server}</span>)}</div>
      <div className="tile-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, margin: '14px 0' }}>{[['Orders', s.performance.orders], ['Fill rate', s.performance.fillRate == null ? '—' : `${s.performance.fillRate}%`], ['Rejection', s.performance.rejectionRate == null ? '—' : `${s.performance.rejectionRate}%`], ['Contracts', s.contracts.length]].map(([l, v]) => <div key={l as string} className="card tight" style={{ marginBottom: 0 }}><div className="mut" style={{ fontSize: 12 }}>{l}</div><b style={{ fontSize: 20 }}>{v}</b></div>)}</div>
      {s.contracts.length > 0 && <><h2>Contracts</h2>{s.contracts.map((c: any) => <Link key={c.id} href={`/contracts/${c.id}`} onClick={onClose} className="mini-match"><div style={{ flex: 1 }}><b>{c.number}</b><div className="mut" style={{ fontSize: 12 }}>{dmy(c.validFrom)} – {dmy(c.validTo)} · {c.lines} items</div></div><span className={`tag ${c.status === 'published' ? 'ok' : 'warn'}`}>{c.status}</span></Link>)}</>}
      {s.orders.length > 0 && <><h2 style={{ marginTop: 14 }}>Recent orders</h2>{s.orders.slice(0, 5).map((o: any) => <Link key={o.id} href={`/requirements/${o.requirementId ?? ''}`} className="mini-match" onClick={(e) => { if (!o.requirementId) e.preventDefault(); }}><div style={{ flex: 1 }}><b>{o.po ?? o.requirement}</b><div className="mut" style={{ fontSize: 12 }}>{o.plant} · {inr(o.value)}</div></div><span className={`tag ${STATUS_TONE(o.status)}`}>{STATUS_LABEL[o.status] ?? o.status}</span></Link>)}</>}</>}</div></aside></>;
}
