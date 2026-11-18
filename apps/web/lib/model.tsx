import React from 'react';
import { Icon, IconName } from '../components/Icon';
/** Plain-language outcome of routing for a buyer. The platform decides; the buyer just sees how it will be bought. */
export interface Routing { route: string; model: 1 | 2 | 3 | null; unitPrice?: number | null; reason?: string | null }
export function modelInfo(r: Routing | null | undefined): { cls: string; title: string; text: string; icon: IconName } {
  if (!r) return { cls: 'none', title: 'Select your plant', text: 'Choose a plant to see how this item is bought.', icon: 'pin' };
  if (r.route === 'arc') return { cls: 'm2', title: 'Your contract supplier', text: 'Bought on your existing contract. ProcMart coordinates delivery.', icon: 'file' };
  if (r.route === 'direct') return { cls: 'm1', title: 'Supplied by ProcMart', text: 'From ProcMart stock at the agreed category price.', icon: 'package' };
  if (r.route === 'sourcing') return { cls: 'm3', title: 'ProcMart gets you quotes', text: 'No contract yet. ProcMart collects quotes for your approval.', icon: 'handshake' };
  if (r.route === 'award') return { cls: 'm3', title: 'Awarded after quotes', text: 'Supplier chosen from competing quotes.', icon: 'handshake' };
  if (r.route === 'exception') return { cls: 'exc', title: 'Needs a decision', text: 'A procurement decision is needed before this can be ordered.', icon: 'alert' };
  return { cls: 'none', title: 'Use your usual process', text: 'Not available through MonoSource for your plant yet.', icon: 'info' };
}
export function ModelBadge({ r, compact }: { r: Routing | null | undefined; compact?: boolean }) {
  const m = modelInfo(r);
  return <div className={`model ${m.cls}`}><span className="mi"><Icon name={m.icon} size={15} /></span><div><b>{m.title}</b>{!compact && m.text}</div></div>;
}
