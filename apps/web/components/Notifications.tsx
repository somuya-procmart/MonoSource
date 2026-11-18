'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { Icon, IconName } from './Icon';
import { ago, plain } from '../lib/format';

/** Notifications = something happened. Tasks (what must be done) live in "Needs me" / the work queue, never here. */
const CAT: Record<string, { label: string; icon: IconName; bg: string; fg: string }> = {
  milestone: { label: 'Milestone', icon: 'flag', bg: '#eef2ff', fg: '#2547d0' }, human: { label: 'Action needed from a person', icon: 'userCheck', bg: '#fff1ec', fg: '#a8340f' },
  supplier: { label: 'Supplier response', icon: 'mail', bg: '#f0eeff', fg: '#5b4bd8' }, delay: { label: 'Delay', icon: 'clock', bg: '#fff6e6', fg: '#b54708' }, complete: { label: 'Completed', icon: 'checkCircle', bg: '#e9f7ef', fg: '#067647' },
};
const PREFS: [string, string, string][] = [['milestones', 'Important milestones', 'Submitted, suppliers identified, PO created, dispatched'], ['human', 'Human action required', 'When a person has to decide something'], ['supplier', 'Supplier response received', 'Quotations and reminders'], ['delays', 'Delays and exceptions', 'When something is taking longer than expected'], ['completion', 'Completion', 'When your requirement is fulfilled']];

export function NotificationBell() {
  const router = useRouter(); const [open, setOpen] = useState(false); const [d, setD] = useState<any>(null); const [view, setView] = useState<'list' | 'prefs'>('list'); const [preview, setPreview] = useState<string | null>(null); const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(() => api('/notifications').then(setD).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (!open) return; const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; document.addEventListener('mousedown', f); document.addEventListener('keydown', k); return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); }; }, [open]);
  const go = async (n: any) => { if (!n.read) { await api('/notifications/read', { body: { ids: [n.id] } }).catch(() => {}); load(); } setOpen(false); router.push(n.href ?? '/'); };
  const setPref = async (k: string, v: boolean) => { const prefs = { ...d.prefs, [k]: v }; setD({ ...d, prefs }); await api('/notification-prefs', { method: 'PUT', body: { prefs } }).catch(() => {}); };
  const unread = d?.unread ?? 0;
  return <div className="menu" ref={ref} style={{ position: 'relative' }}>
    <button className="iconbtn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => { setOpen(!open); setView('list'); }} style={{ position: 'relative' }}><Icon name="bell" size={20} />{unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}</button>
    {open && <div className="notif-pop" role="dialog" aria-label="Notifications">
      <div className="row" style={{ padding: '12px 14px', margin: 0, justifyContent: 'space-between', borderBottom: '1px solid var(--bd)' }}><b>{view === 'list' ? 'Notifications' : 'Notification preferences'}</b>
        <span className="row" style={{ margin: 0, gap: 6 }}>{view === 'list' ? <>{unread > 0 && <button className="sec" style={{ height: 28, fontSize: 12 }} onClick={async () => { await api('/notifications/read', { body: { all: true } }); load(); }}>Mark all read</button>}<button className="icon" aria-label="Preferences" title="Preferences" style={{ width: 30, height: 30 }} onClick={() => setView('prefs')}><Icon name="sliders" size={15} /></button></> : <button className="sec" style={{ height: 28 }} onClick={() => setView('list')}>Back</button>}</span></div>
      {view === 'list' ? (!d ? <div className="skel" style={{ height: 120, margin: 12 }} /> : !d.items.length ? <div className="empty" style={{ padding: 28 }}><b>No notifications yet</b>When a requirement moves forward you’ll see it here — </div>
        : d.items.map((n: any) => { const c = CAT[n.category] ?? CAT.milestone; return <div key={n.id}><div className={`notif-row ${n.read ? '' : 'unread'}`} role="button" tabIndex={0} onClick={() => go(n)} onKeyDown={(e) => e.key === 'Enter' && go(n)}>
          <span className="ni" style={{ background: c.bg, color: c.fg }}><Icon name={c.icon} size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: n.read ? 550 : 700, fontSize: 13 }}>{plain(n.title)}</div>{n.body && <div className="mut" style={{ fontSize: 12 }}>{plain(n.body)}</div>}
            <div className="mut" style={{ fontSize: 12, marginTop: 3, display: 'flex', gap: 8, alignItems: 'center' }}><span>{c.label}</span>·<span>{ago(n.at)}</span>{n.number && <>·<span>{n.number}</span></>}
              {d.prefs.email && <button className="sec" style={{ height: 20, fontSize: 11, padding: '0 6px', border: 0, background: '#f2f4f7' }} onClick={(e) => { e.stopPropagation(); setPreview(preview === n.id ? null : n.id); }}>{preview === n.id ? 'Hide preview' : 'Email preview'}</button>}</div></div>{!n.read && <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--pri)', marginTop: 6 }} aria-label="Unread" />}</div>
          {preview === n.id && <div style={{ padding: '0 14px 12px 54px', borderBottom: '1px solid var(--bd)' }}><div className="msg-prev"><small>Email preview — illustrative, not sent</small><b>{n.email.subject}{'\n'}</b>{n.email.body}</div>{d.prefs.whatsapp && <div className="msg-prev wa"><small>WhatsApp preview — illustrative, not sent</small>{n.whatsapp}</div>}</div>}</div>; }))
        : <div style={{ padding: 14, display: 'grid', gap: 10 }}>{d && PREFS.map(([k, l, h]) => <label key={k} className="fopt" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={d.prefs[k] !== false} onChange={(e) => setPref(k, e.target.checked)} /><span><b style={{ fontSize: 13 }}>{l}</b><div className="mut" style={{ fontSize: 12 }}>{h}</div></span></label>)}
          <div className="mut" style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>PREVIEW CHANNELS (illustrative — nothing is sent)</div>
          <label className="fopt"><input type="checkbox" checked={d?.prefs.email !== false} onChange={(e) => setPref('email', e.target.checked)} /><span>Show email previews</span></label><label className="fopt"><input type="checkbox" checked={!!d?.prefs.whatsapp} onChange={(e) => setPref('whatsapp', e.target.checked)} /><span>Show WhatsApp previews</span></label></div>}
    </div>}</div>;
}
