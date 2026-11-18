'use client';
import { Icon, IconName } from './Icon';
import { price } from '../lib/format';

/**
 * Two ways to buy, nothing else: a group ARC exists (the order goes to it), or ProcMart instant procurement gets it.
 * The API's B/D/E cases all mean "no ARC usable" and read as ProcMart here.
 */
const ARC = { tone: 'ok', icon: 'checkCircle' as IconName, label: 'On contract', short: 'On contract' };
const PM = { tone: 'pm', icon: 'zap' as IconName, label: 'Via ProcMart', short: 'Via ProcMart' };
export const CASES: Record<string, { tone: string; icon: IconName; label: string; short: string }> = { A: ARC, B: PM, D: PM, E: PM };
export const onContract = (src: any) => src?.case === 'A';

export function SourceBadge({ src, plant, compact }: { src: any; plant?: boolean; compact?: boolean }) {
  if (!src) return null;
  if (!plant) return <span className="tag">Pick a plant</span>;
  const c = CASES[src.case] ?? PM; const label = src.case === 'A' && src.multiple ? `${src.count ?? src.supplies?.length} suppliers on contract` : c.label;
  return <span className={`tag ${c.tone}`} style={{ gap: 6 }}><Icon name={c.icon} size={13} />{compact && !(src.case === 'A' && src.multiple) ? c.short : label}</span>;
}
/** The one-line summary shown in result rows. */
export function SourceSummary({ it, plant }: { it: any; plant: boolean; plantName?: string }) {
  const s = it.source; if (!s) return null;
  if (!plant) return <div className="mut" style={{ fontSize: 13 }}>Pick a plant for price</div>;
  if (s.case === 'A') return <div><div style={{ marginBottom: 4 }}><SourceBadge src={s} plant /></div><div className="price">{s.multiple && <small>from </small>}{price(s.lowestPrice)}<small> / {it.uom}</small></div>
    <div className="psub">{s.multiple ? `${s.supplies[0].supplier} +${s.supplies.length - 1}` : s.supplies[0].supplier}</div></div>;
  return <div><div style={{ marginBottom: 4 }}><SourceBadge src={s} plant /></div><div className="psub">Price on quote</div></div>;
}
export function AltChip({ s }: { s: any }) { const n = (s?.alternatives?.approved ?? 0) + (s?.alternatives?.suggested ?? 0); return n ? <span className="tag pri" style={{ marginLeft: 6 }}><Icon name="swap" size={12} />{n} alternative{n > 1 ? 's' : ''}</span> : null; }
