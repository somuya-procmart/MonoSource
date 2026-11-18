'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/** One confirmation dialog for consequential actions: `if (await confirm({...})) doIt()`. Esc or Cancel says no. */
interface Ask { title: string; body?: ReactNode; confirm: string; cancel?: string; danger?: boolean }
const C = createContext<(a: Ask) => Promise<boolean>>(async () => true);
export const useConfirm = () => useContext(C);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<(Ask & { done: (v: boolean) => void }) | null>(null); const ok = useRef<HTMLButtonElement>(null); const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useCallback((a: Ask) => new Promise<boolean>((done) => setAsk({ ...a, done })), []);
  const close = (v: boolean) => { ask?.done(v); setAsk(null); };
  useEffect(() => { if (!ask) return; (ask.danger ? cancel : ok).current?.focus(); /* a destructive action never has the focus by default */ const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }); // eslint-disable-line
  return <C.Provider value={confirm}>{children}
    {ask && <><div className="scrim" onClick={() => close(false)} /><div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="cf-t" aria-describedby="cf-b" style={{ width: 'min(460px,calc(100vw - 32px))' }}>
      <div className="modal-h"><div style={{ display: 'flex', gap: 'var(--sp-3)' }}><span className={`cf-ic ${ask.danger ? 'bad' : ''}`}><Icon name={ask.danger ? 'alert' : 'info'} size={18} /></span><div><h2 id="cf-t">{ask.title}</h2>{ask.body && <div id="cf-b" className="mut small">{ask.body}</div>}</div></div></div>
      <div className="modal-f"><button ref={cancel} className="sec" onClick={() => close(false)}>{ask.cancel ?? 'Cancel'}</button><button ref={ok} className={ask.danger ? 'danger' : ''} onClick={() => close(true)}>{ask.confirm}</button></div></div></>}
  </C.Provider>;
}
