'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { useApp } from '../shell';
import { Icon } from '../../components/Icon';
import { Thumb } from '../../components/Thumb';
import { SourceSummary, AltChip } from '../../components/Source';
import { useOpenProduct } from '../../components/ProductPanel';
import { NonCatalogueDialog } from '../../components/NonCatalogue';
import { useAddToCart } from '../../components/ProductBits';

type Msg = { id: number; role: 'me' | 'ai'; kind: 'text' | 'clarify' | 'results' | 'added' | 'attach'; text?: string; q?: any; items?: any[]; total?: number; chips?: string[]; done?: boolean; name?: string; steps?: string[]; options?: string[] };
interface Ctx { text: string; answers: Record<string, string>; skipped: string[]; qty?: number }
const KEY = 'ms_ask';
const parseQty = (t: string) => { const m = t.match(/\b(\d{1,6})\s*(units?|pcs|pieces|nos|numbers)\b/i) ?? t.match(/\b(?:need|want|require|order|buy|get)\s+(\d{1,6})\b(?!\s*(?:mm|cm|v|a|kw|hp|in|inch))/i); return m ? Number(m[1]) : undefined; };

function ResultCard({ it, qty, plant, plantName, onAdded }: { it: any; qty: number; plant: string; plantName?: string; onAdded: (m: string) => void }) {
  const add = useAddToCart(); const { open } = useOpenProduct(); const s = it.source; const [q, setQ] = useState(Math.max(qty, Number(s?.supplies?.[0]?.moq ?? 1))); const [busy, setBusy] = useState(false);
  const run = async (extra: any, label: string, cl?: string) => { setBusy(true); const ok = await add(it, q, cl, extra); setBusy(false); if (ok) onAdded(`${label}: ${q} × ${it.name}`); };
  const A = plant && s?.case === 'A' && !s.multiple; const note = 'Requested via Ask MonoSource.';
  return <div className="card" style={{ margin: 0, padding: 14, display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', gap: 14 }}>
    <div className="pthumb" style={{ width: 64, height: 64, borderRadius: 12 }}><Thumb imageId={it.imageId} category={it.category} size={64} /></div>
    <div style={{ minWidth: 0 }}><b>{it.name}</b><div className="psub">{[it.brand, it.mpn].filter(Boolean).join(' · ')}<AltChip s={s} /></div>
      <div style={{ margin: '8px 0' }}><SourceSummary it={it} plant={!!plant} plantName={plantName} /></div>
      {it.unknownSpecs?.length > 0 && <div className="tag warn" style={{ marginBottom: 8 }}><Icon name="info" size={12} />Doesn’t record: {it.unknownSpecs.join(', ')} — please confirm</div>}
      <div className="row" style={{ marginBottom: 0 }}>
        {plant && !(s?.case === 'A' && s.multiple) && <label className="row" style={{ marginBottom: 0, gap: 6 }}><span className="mut" style={{ fontSize: 13 }}>Qty</span><input type="number" min={1} value={q} onChange={(e) => setQ(Math.max(1, Number(e.target.value) || 1))} style={{ width: 90, height: 36 }} aria-label="Quantity" /></label>}
        {A && <button className="btn sm pri" disabled={busy} onClick={() => run({}, 'Added', s.supplies[0].contractLineId)}><Icon name="cart" size={15} />Add to requirement</button>}
        {plant && s?.case === 'A' && s.multiple && <button className="btn sm pri" onClick={() => open(it.id)}>Compare {s.supplies.length} suppliers</button>}
        {plant && s?.case !== 'A' && <button className="btn sm pri" disabled={busy} onClick={() => run({ intent: 'source', note }, 'Added')}><Icon name="cart" size={15} />Add to requirement</button>}
        <button className="btn sm ghost" onClick={() => open(it.id)}>Details</button></div></div></div>;
}

function Chat() {
  const router = useRouter(); const sp = useSearchParams(); const { plant, plants, cart, openCart, notify } = useApp(); const plantName = plants.find((p) => p.id === plant)?.name;
  const [msgs, setMsgs] = useState<Msg[]>([]); const [ctx, setCtx] = useState<Ctx>({ text: '', answers: {}, skipped: [] }); const [busy, setBusy] = useState(false); const [step, setStep] = useState(0); const [input, setInput] = useState(''); const [nc, setNc] = useState(false);
  const [agent, setAgent] = useState<{ on: boolean; model?: string } | null>(null); const hist = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  useEffect(() => { api('/ask/capabilities').then((r) => setAgent({ on: !!r.agent, model: r.model })).catch(() => setAgent({ on: false })); }, []);
  const id = useRef(0); const end = useRef<HTMLDivElement>(null); const started = useRef(false); const file = useRef<HTMLInputElement>(null);
  const push = useCallback((m: Omit<Msg, 'id'>) => setMsgs((x) => [...x, { ...m, id: ++id.current }]), []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);
  useEffect(() => { try { if (msgs.length) sessionStorage.setItem(KEY, JSON.stringify({ msgs, ctx, id: id.current })); } catch { /* ignore */ } }, [msgs, ctx]);
  useEffect(() => { if (!busy) { setStep(0); return; } const a = setTimeout(() => setStep(1), 500), b = setTimeout(() => setStep(2), 1000); return () => { clearTimeout(a); clearTimeout(b); }; }, [busy]);

  const turn = useCallback(async (c: Ctx) => {
    setBusy(true);
    try {
      const res = await api('/ask', { body: { text: c.text, plantId: plant || undefined, answers: c.answers, skipped: c.skipped } });
      const qty = c.qty ?? parseQty(c.text);
      if (!res.candidates?.length) { push({ role: 'ai', kind: 'text', text: res.message ?? 'I couldn’t find that in the catalogue.', chips: ['Request a new item', 'Try different words'] }); }
      else if (res.question && !res.done && res.total > 3) push({ role: 'ai', kind: 'clarify', q: res.question, total: res.total, text: `I found ${res.total} possible items. ${Object.keys(res.answers).length ? 'So far I understood ' + Object.entries(res.answers).map(([k, a]: any) => `${(a.label ?? k).toLowerCase()} ${a.value}`).join(', ') + '. ' : ''}` });
      else push({ role: 'ai', kind: 'results', items: res.candidates.slice(0, 4), total: res.total, done: true, text: res.total === 1 ? 'This is the match. Here is how your plant can buy it:' : `Here ${res.total > 4 ? 'are the best 4 of ' + res.total : 'are ' + res.total} matches and how your plant can buy each:`, chips: qty ? [] : ['I need a different item', 'Request a new item'] });
    } catch (e: any) { push({ role: 'ai', kind: 'text', text: `Something went wrong: ${e.message}`, chips: ['Try again'] }); }
    setBusy(false);
  }, [plant, push]);

  const agentTurn = useCallback(async (t: string) => {
    setBusy(true); hist.current = [...hist.current, { role: 'user', content: t }];
    try {
      const res = await api('/ask/agent', { body: { messages: hist.current, plantId: plant || undefined } });
      hist.current = [...hist.current, { role: 'assistant', content: [res.reply, res.question?.text].filter(Boolean).join(' ') || '(showed products)' }];
      const steps = (res.steps ?? []).map((x: any) => x.label).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
      push({ role: 'ai', kind: res.items?.length ? 'results' : 'text', text: res.reply || (res.question ? '' : 'Here is what I found:'), items: res.items, steps, options: res.question?.options, q: res.question ? { label: res.question.text } : undefined, chips: !res.items?.length && !res.question ? ['Request a new item'] : [] });
    } catch (e: any) { push({ role: 'ai', kind: 'text', text: `I couldn’t answer that: ${e.message}`, chips: ['Try again'] }); hist.current = hist.current.slice(0, -1); }
    setBusy(false);
  }, [plant, push]);

  const send = useCallback((text: string, fresh = false) => {
    const t = text.trim(); if (!t || busy) return; push({ role: 'me', kind: 'text', text: t });
    if (agent?.on) { if (fresh) hist.current = []; agentTurn(t); return; }
    const base: Ctx = fresh || !ctx.text ? { text: t, answers: {}, skipped: [], qty: parseQty(t) } : { ...ctx, text: `${ctx.text} ${t}`, qty: ctx.qty ?? parseQty(t) };
    setCtx(base); turn(base);
  }, [busy, ctx, push, turn, agent, agentTurn]);

  useEffect(() => { // start from the query handed over by the search bar, or restore the conversation
    if (started.current || agent === null) return; const q = sp.get('q');
    if (q) { started.current = true; send(q, true); return; }
    try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s?.msgs?.length) { started.current = true; id.current = s.id; setMsgs(s.msgs); setCtx(s.ctx); } } catch { /* ignore */ }
  }, [sp, agent]); // eslint-disable-line

  const answer = (key: string, value: string, label?: string) => { push({ role: 'me', kind: 'text', text: label ?? value }); const c = { ...ctx, answers: { ...ctx.answers, [key]: value } }; setCtx(c); turn(c); };
  const skip = (key: string) => { push({ role: 'me', kind: 'text', text: 'Not sure' }); const c = { ...ctx, skipped: [...ctx.skipped, key] }; setCtx(c); turn(c); };
  const showNow = () => { push({ role: 'me', kind: 'text', text: 'Show me the matches now' }); const c = { ...ctx, skipped: [...ctx.skipped, '__all'] }; setCtx(c); (async () => { setBusy(true); const res = await api('/ask', { body: { text: ctx.text, plantId: plant || undefined, answers: ctx.answers, skipped: [...ctx.skipped, '__all'] } }); push({ role: 'ai', kind: 'results', items: res.candidates.slice(0, 4), total: res.total, text: `Here are the closest ${Math.min(4, res.candidates.length)} of ${res.total}:` }); setBusy(false); })(); };
  const chip = (c: string) => { if (c === 'Request a new item') setNc(true); else if (c === 'Try again') { if (agent?.on) { const last = [...msgs].reverse().find((m) => m.role === 'me')?.text; if (last) agentTurn(last); } else turn(ctx); } else if (c === 'Try different words' || c === 'I need a different item') { setCtx({ text: '', answers: {}, skipped: [] }); push({ role: 'ai', kind: 'text', text: 'Okay — describe it another way (a name, brand, part number, or what it’s used for).' }); } else send(c); };
  const reset = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } hist.current = []; setMsgs([]); setCtx({ text: '', answers: {}, skipped: [] }); router.replace('/ask'); started.current = false; };
  const lines = cart?.lines?.length ?? 0;
  return <div className="chat">
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><div><Link href="/" className="btn sm ghost"><Icon name="chevronLeft" size={15} />Back to buying workspace</Link></div>
      <div className="row" style={{ marginBottom: 0, gap: 8 }}>{agent?.on && <span className="tag pri" title={`Agent model: ${agent.model}`}><Icon name="sparkles" size={12} />Agent</span>}<span className="tag"><Icon name="pin" size={12} />{plantName ?? 'No plant selected'}</span><button className="sec" style={{ height: 32 }} onClick={reset}>New conversation</button></div></div>
    {!plant && <div className="banner"><Icon name="pin" size={18} /><span>Select your plant (top right) so I can tell you whether each item is on a contract you can use.</span></div>}
    <div className="chat-scroll" aria-live="polite">
      {!msgs.length && !busy && <div className="msg"><span className="av"><Icon name="sparkles" size={16} /></span><div style={{ display: 'grid', gap: 10 }}><div className="bub">Tell me what you need — a name, a spec, a part number, or what it’s for. I’ll check the catalogue and your group’s contracts, and ask only what I can’t work out.</div><div className="sugg">{['MCB 32A 2 pole', 'LT power cable 4 core 16 sqmm aluminium', 'Is there a live ARC for safety shoes?', 'Something to cut grass'].map((s) => <button key={s} onClick={() => send(s, true)}>{s}</button>)}</div></div></div>}
      {msgs.map((m, i) => m.role === 'me' ? <div key={m.id} className="msg me"><div className="bub">{m.kind === 'attach' ? <><Icon name="paperclip" size={14} /> {m.name}</> : m.text}</div></div> :
        <div key={m.id} className="msg"><span className="av"><Icon name="sparkles" size={16} /></span><div style={{ display: 'grid', gap: 10, minWidth: 0, flex: 1 }}>
          {m.steps?.length ? <div className="mut row" style={{ fontSize: 12, gap: 6, marginBottom: 0 }}>{m.steps.map((t) => <span key={t} className="row" style={{ gap: 4, marginBottom: 0 }}><Icon name="checkCircle" size={13} style={{ color: 'var(--ok)' }} />{t}</span>)}</div> : null}
          {m.text && <div className="bub" style={{ width: 'fit-content', maxWidth: '100%' }}>{m.text}</div>}
          {m.options?.length ? <div className="card" style={{ margin: 0, padding: 14 }}><div style={{ fontWeight: 600, marginBottom: 10 }}>{m.q?.label}</div>{i === msgs.length - 1 && !busy && <div className="row" style={{ marginBottom: 0 }}>{m.options.map((o) => <button key={o} className="opt" onClick={() => send(o)}>{o}</button>)}</div>}</div> : null}
          {m.kind === 'clarify' && !m.options && <div className="card" style={{ margin: 0, padding: 14 }}><div style={{ fontWeight: 600, marginBottom: 2 }}>{m.q.label}?{m.q.required && <span className="tag warn" style={{ marginLeft: 8 }}>Needed</span>}</div><div className="mut" style={{ fontSize: 13, marginBottom: 10 }}>{m.q.unknownCount > 0 ? `${m.q.unknownCount} items don’t record this detail.` : 'This narrows the list the most.'}</div>
            {i === msgs.length - 1 && <div className="row" style={{ marginBottom: 0 }}>{m.q.options.map((o: any) => <button key={o.value} className="opt" onClick={() => answer(m.q.key, o.value, o.label)}>{o.label ?? o.value}<small>{o.count}</small></button>)}{!m.q.required && <button className="opt" style={{ borderStyle: 'dashed', color: 'var(--mut)' }} onClick={() => skip(m.q.key)}>Not sure</button>}<button className="opt" style={{ borderStyle: 'dashed', color: 'var(--pri)' }} onClick={showNow}>Show the {m.total} matches</button></div>}</div>}
          {m.kind === 'results' && <div style={{ display: 'grid', gap: 10 }}>{m.items!.map((it) => <ResultCard key={it.id} it={it} qty={ctx.qty ?? 1} plant={plant} plantName={plantName} onAdded={(t) => push({ role: 'ai', kind: 'added', text: `${t}. You can keep asking, or review and submit your requirement.`, chips: ['Review requirement'] })} />)}</div>}
          {m.chips && i === msgs.length - 1 && !busy && <div className="sugg">{m.chips.map((c) => <button key={c} onClick={() => c === 'Review requirement' ? openCart() : chip(c)}>{c}</button>)}</div>}</div></div>)}
      {busy && <div className="msg"><span className="av"><Icon name="sparkles" size={16} /></span><div className="bub" style={{ display: 'grid', gap: 6 }}>
        {(agent?.on ? ['Understanding what you need', 'Searching the catalogue and group ARCs', 'Choosing the best matches'] : ['Searching the catalogue', 'Checking group contracts', 'Preparing your options']).slice(0, step + 1).map((t, i) => <div key={t} className="row" style={{ marginBottom: 0, gap: 8, fontSize: 13 }}><Icon name={i < step ? 'checkCircle' : 'sparkles'} size={14} style={{ color: i < step ? 'var(--ok)' : 'var(--agent)' }} />{t}{i === step && <span className="typing"><i /><i /><i /></span>}</div>)}</div></div>}
      <div ref={end} /></div>
    {lines > 0 && <div className="banner" style={{ margin: '0 0 10px', alignItems: 'center' }}><Icon name="cart" size={18} /><span style={{ flex: 1 }}>{lines} item{lines > 1 ? 's' : ''} in your requirement</span><button className="btn sm pri" onClick={openCart}>Review &amp; submit</button></div>}
    <form className="chat-in" onSubmit={(e) => { e.preventDefault(); const t = input; setInput(''); send(t); }}>
      <input ref={file} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { push({ role: 'me', kind: 'attach', name: f.name }); push({ role: 'ai', kind: 'text', text: 'I’ve attached it to this conversation for reference. In this demo I can’t read files yet — please describe the item (name, brand, part number or use) and I’ll find it.' }); } e.target.value = ''; }} />
      <button type="button" className="icon" aria-label="Attach a file" title="Attach a photo, drawing or old PO" onClick={() => file.current?.click()} style={{ background: 'transparent', border: 0, boxShadow: 'none', color: 'var(--mut)' }}><Icon name="paperclip" size={18} /></button>
      <textarea rows={1} value={input} placeholder={msgs.length ? 'Reply, or describe something else…' : 'Describe what you need…'} aria-label="Message MonoSource" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
      <button className="btn pri" type="submit" disabled={!input.trim() || busy} aria-label="Send"><Icon name="send" size={16} />Send</button></form>
    {nc && <NonCatalogueDialog initial={ctx.text} onClose={() => setNc(false)} />}
  </div>;
}
export default function Ask() { return <Suspense><Chat /></Suspense>; }
