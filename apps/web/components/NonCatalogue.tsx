'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../app/shell';
import { Icon } from './Icon';

/** Non-catalogue requirement: describe what you need; procurement finds a source. Lands in the cart as a sourcing line. */
export function NonCatalogueDialog({ initial = '', onClose }: { initial?: string; onClose: () => void }) {
  const { plant, refreshCart, openCart, notify } = useApp(); const [f, setF] = useState({ name: initial, brand: '', mpn: '', spec: '', reason: '', qty: '1', uom: 'EA', needBy: '' }); const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const submit = async () => { setBusy(true); try { await api('/cart/non-catalogue', { body: { plantId: plant, name: f.name, brand: f.brand || undefined, mpn: f.mpn || undefined, spec: f.spec || undefined, reason: f.reason || undefined, qty: Number(f.qty), uom: f.uom, needBy: f.needBy || undefined } }); await refreshCart(); notify(`Added ${f.name} to your requirement`); onClose(); openCart(); } catch (e: any) { notify(e.message, { error: true }); } setBusy(false); };
  return <><div className="scrim" onClick={onClose} /><div className="modal" role="dialog" aria-modal="true" aria-label="Non-catalogue requirement">
    <div className="modal-h"><div><h2>Request a new item</h2><div className="mut small">ProcMart quotes and supplies it.</div></div><button className="sec icon" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button></div><div className="modal-b">
    <label className="field"><span>What do you need?</span><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Rubber mounts 40 × 40 mm" autoFocus /></label>
    <div className="row"><label className="field" style={{ width: 110, marginBottom: 0 }}><span>Quantity</span><input type="number" min={1} value={f.qty} onChange={(e) => set('qty', e.target.value)} /></label><label className="field" style={{ width: 100, marginBottom: 0 }}><span>Unit</span><input value={f.uom} onChange={(e) => set('uom', e.target.value)} /></label><label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Need by</span><input type="date" value={f.needBy} onChange={(e) => set('needBy', e.target.value)} /></label></div>
    <details className="nc-more"><summary><Icon name="plus" size={14} />Add brand, part number or specs</summary>
      <div className="row" style={{ marginTop: 12 }}><label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Brand</span><input value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Any" /></label><label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Part number</span><input value={f.mpn} onChange={(e) => set('mpn', e.target.value)} /></label></div>
      <label className="field" style={{ marginTop: 12, marginBottom: 0 }}><span>Specs</span><textarea style={{ width: '100%' }} value={f.spec} onChange={(e) => set('spec', e.target.value)} placeholder="Size, material, rating" /></label></details>
    {!plant && <div className="banner" style={{ marginTop: 'var(--sp-3)' }}><Icon name="pin" size={16} /><span>Pick your plant first.</span></div>}</div>
    <div className="modal-f"><button className="sec" onClick={onClose}>Cancel</button><button className={busy ? 'busy' : ''} disabled={busy || f.name.trim().length < 3 || !(Number(f.qty) > 0) || !plant} onClick={submit}>Add to requirement</button></div></div></>;
}
