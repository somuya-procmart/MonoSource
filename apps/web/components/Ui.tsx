import React from 'react';
import { Icon, IconName } from './Icon';
export function Toast({ t, e, children }: { t?: string; e?: boolean; children?: React.ReactNode }) {
  if (!t) return null;
  return <div className={`toast ${e ? 'e' : ''}`} role={e ? 'alert' : 'status'}><Icon name={e ? 'alert' : 'checkCircle'} size={18} /><span>{t}</span>{children}</div>;
}
export function Empty({ icon = 'inbox', title, children }: { icon?: IconName; title: string; children?: React.ReactNode }) {
  return <div className="empty"><div className="eic"><Icon name={icon} size={24} /></div><b>{title}</b>{children}</div>;
}
export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return <div className="pagehead"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{children}</div>;
}
export function Skeleton({ n = 3, h = 220 }: { n?: number; h?: number }) {
  return <div className="grid4">{Array.from({ length: n }, (_, i) => <div key={i} className="skel" style={{ height: h }} />)}</div>;
}
