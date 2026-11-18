'use client';
import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from './Icon';
import { ProductDetail } from './ProductDetail';

/** Opens/closes the product panel through the URL (?open=<itemId>) so Back, reload and sharing all work. */
export function useOpenProduct() {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const open = useCallback((id: string | null) => { const p = new URLSearchParams(sp.toString()); id ? p.set('open', id) : p.delete('open'); router.push(`${path}${p.toString() ? `?${p}` : ''}`, { scroll: false }); }, [router, path, sp]);
  return { open, current: sp.get('open') };
}
export function ProductPanel() {
  const { open, current } = useOpenProduct();
  useEffect(() => { if (!current) return; const h = (e: KeyboardEvent) => e.key === 'Escape' && open(null); document.addEventListener('keydown', h); const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.removeEventListener('keydown', h); document.body.style.overflow = o; }; }, [current, open]);
  if (!current) return null;
  return <><div className="scrim" onClick={() => open(null)} /><aside className="drawer wide" role="dialog" aria-label="Product details" style={{ width: 'min(820px,100vw)' }}>
    <div className="drawer-h" style={{ padding: '10px 16px' }}><button className="sec" onClick={() => open(null)}><Icon name="chevronLeft" size={16} />Back to results</button><button className="sec icon" aria-label="Close" onClick={() => open(null)}><Icon name="x" size={18} /></button></div>
    <ProductDetail id={current} variant="panel" onClose={() => open(null)} /></aside></>;
}
