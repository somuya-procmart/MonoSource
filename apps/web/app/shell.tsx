'use client';
import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken, setToken } from '../lib/api';
import { Icon, IconName } from '../components/Icon';
import { GlobalSearch } from '../components/GlobalSearch';
import { CartDrawer } from '../components/CartDrawer';
import { NotificationBell } from '../components/Notifications';
import { ConfirmProvider } from '../components/Confirm';
import { ProductPanel } from '../components/ProductPanel';

export interface Me { kind?: string; id: string; email: string; name: string; tenant: { slug: string; name: string; demo?: boolean }; platform: boolean; assignments: { perms: string[]; scopeNodeId: string | null }[] }
export interface Plant { id: string; name: string; code: string; server: string }
export interface Notice { id: number; text: string; error?: boolean; info?: boolean; href?: string; label?: string }
interface Ctx {
  me: Me | null; plants: Plant[]; plant: string; setPlant: (id: string) => void;
  cart: any; cartCount: number; refreshCart: () => Promise<any>; openCart: () => void; notify: (text: string, o?: { error?: boolean; info?: boolean; href?: string; label?: string }) => void;
}
const C = createContext<Ctx>({ me: null, plants: [], plant: '', setPlant: () => {}, cart: null, cartCount: 0, refreshCart: async () => null, openCart: () => {}, notify: () => {} });
export const useApp = () => useContext(C);
export const useMe = () => useContext(C).me;
export const can = (me: Me | null, p: string) => !!me?.assignments.some((a) => a.perms.some((g) => g === '*' || g === p || (g.endsWith(':*') && p.startsWith(g.slice(0, -1)))));
export const canAny = (me: Me | null, ...ps: string[]) => ps.some((p) => can(me, p));

interface NavItem { href: string; label: string; icon: IconName; show: (me: Me | null) => boolean; match?: (p: string) => boolean }
const buyer = (me: Me | null) => can(me, 'buying:request');
const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Buy', items: [
    { href: '/', label: 'Find & buy', icon: 'search', show: (m) => can(m, 'catalogue:read'), match: (p) => p === '/' || p.startsWith('/search') || p.startsWith('/product') || p.startsWith('/compare') || p.startsWith('/ask') },
    { href: '/activity', label: 'My activity', icon: 'list', show: (m) => can(m, 'catalogue:read'), match: (p) => p.startsWith('/activity') || p.startsWith('/requirements') }] },
  { label: 'Procurement', items: [
    { href: '/contracts', label: 'Contracts', icon: 'file', show: (m) => can(m, 'contracts:read') },
    { href: '/sourcing', label: 'Sourcing', icon: 'handshake', show: (m) => canAny(m, 'buying:source', 'buying:approve') },
    { href: '/work', label: 'Work queue', icon: 'alert', show: (m) => canAny(m, 'buying:source', 'contracts:approve') },
    { href: '/insights', label: 'Overview', icon: 'chart', show: (m) => can(m, 'analytics:read') }] },
  { label: 'Administration', items: [
    { href: '/admin', label: 'Administration', icon: 'cog', show: (m) => canAny(m, 'org:write', 'users:write', 'catalogue:write', 'allocation:write', 'policy:write') || !!m?.platform }] },
];
const SUPPLIER_NAV: NavItem[] = [{ href: '/portal', label: 'Orders', icon: 'truck', show: () => true, match: (p) => p === '/portal' || p.startsWith('/portal/orders') }, { href: '/portal/rfqs', label: 'Quote requests', icon: 'handshake', show: () => true }];
const NO_SEARCH = ['/login', '/portal', '/ask'];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(); const router = useRouter();
  const [me, setMe] = useState<Me | null>(null); const [ready, setReady] = useState(false);
  const [plants, setPlants] = useState<Plant[]>([]); const [plant, setPlantState] = useState('');
  const [cart, setCart] = useState<any>(null); const [cartOpen, setCartOpen] = useState(false);
  const [menu, setMenu] = useState(false); const [collapsed, setCollapsed] = useState(false); const [mobile, setMobile] = useState(false);
  const [work, setWork] = useState(0); const [notices, setNotices] = useState<Notice[]>([]); const nid = useRef(0);

  useEffect(() => { try { setCollapsed(localStorage.getItem('ms_side') === '1'); } catch { /* ignore */ } }, []);
  useEffect(() => {
    if (path === '/login') { setReady(true); return; }
    if (!getToken()) { router.replace('/login'); return; }
    if (me) { if (me.kind === 'supplier' && !path.startsWith('/portal')) router.replace('/portal'); return; } // already signed in: no refetch, no re-render on page switch
    api<Me>('/me').then(async (m) => {
      setMe(m);
      if (m.kind === 'supplier') { if (!path.startsWith('/portal')) router.replace('/portal'); setReady(true); return; }
      if (can(m, 'org:read')) {
        const t: any[] = await api('/org/tree').catch(() => []);
        const p = t.filter((n) => n.levelType === 'plant'); setPlants(p);
        let saved = ''; try { saved = localStorage.getItem('ms_plant') || ''; } catch { /* ignore */ }
        setPlantState(p.find((x) => x.id === saved)?.id ?? (p.length === 1 ? p[0].id : ''));
      }
      setReady(true);
    }).catch(() => router.replace('/login'));
  }, [path, router, me]);
  useEffect(() => { setMobile(false); setMenu(false); }, [path]);

  const setPlant = (id: string) => { setPlantState(id); try { localStorage.setItem('ms_plant', id); } catch { /* ignore */ } };
  const refreshCart = useCallback(async () => {
    if (!plant || !can(me, 'buying:request') || me?.kind === 'supplier') { setCart(null); return null; }
    try { const c = await api(`/cart?plantId=${plant}`); setCart(c); return c; } catch { setCart(null); return null; }
  }, [plant, me]);
  useEffect(() => { refreshCart(); }, [refreshCart]);
  useEffect(() => { if (!me || me.kind === 'supplier' || !canAny(me, 'buying:source', 'contracts:approve')) return; const f = () => api<any>('/work/summary').then((w) => setWork(Number(w.total ?? 0) + Number(w.agenticTasks ?? 0))).catch(() => {}); f(); const t = setInterval(f, 30000); return () => clearInterval(t); }, [me]);
  useEffect(() => { if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('cart') === '1') setCartOpen(true); }, [path]);
  const notify = useCallback((text: string, o: { error?: boolean; info?: boolean; href?: string; label?: string } = {}) => {
    const id = ++nid.current; setNotices((n) => [...n.slice(-3), { id, text, ...o }]); setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), o.error ? 7000 : 4500);
  }, []);
  const value = useMemo<Ctx>(() => ({ me, plants, plant, setPlant, cart, cartCount: cart?.lines?.length ?? 0, refreshCart, openCart: () => setCartOpen(true), notify }), [me, plants, plant, cart, refreshCart, notify]);

  if (!ready) return <div className="page"><div className="skel" style={{ height: 220 }} /></div>;
  if (path === '/login' || !me) return <C.Provider value={value}>{children}</C.Provider>;
  const supplier = me.kind === 'supplier';
  const groups = supplier ? [{ label: 'Supplier portal', items: SUPPLIER_NAV }] : GROUPS;
  const initials = me.name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('');
  const showSearch = !supplier && can(me, 'catalogue:read') && path !== '/' && !NO_SEARCH.some((x) => path.startsWith(x));
  const isOn = (it: NavItem) => it.match ? it.match(path) : path === it.href || path.startsWith(it.href + '/');
  const signOut = () => { setToken(null); window.location.href = '/login'; };

  return (
    <C.Provider value={value}><ConfirmProvider>
      <div className={`app ${collapsed ? 'collapsed' : ''} ${mobile ? 'open' : ''}`}>
        <aside className="side" id="main-nav" aria-label="Main navigation">
          <div className="side-top"><Link href={supplier ? '/portal' : '/'} className="logo"><i />{!collapsed && 'MonoSource'}</Link></div>
          <nav className="side-nav">{groups.map((g) => { const items = g.items.filter((i) => i.show(me)); if (!items.length) return null;
            return <div className="nav-group" key={g.label}><div className="nav-label">{g.label}</div>{items.map((i) => <Link key={i.href} href={i.href} className={`nav-item ${isOn(i) ? 'on' : ''}`} title={collapsed ? i.label : undefined}><Icon name={i.icon} size={18} /><span className="t">{i.label}</span>{i.href === '/work' && work > 0 && <span className="nbadge" aria-label={`${work} items need action`}>{work}</span>}</Link>)}</div>; })}</nav>
          <div className="side-foot"><button aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed} onClick={() => { const v = !collapsed; setCollapsed(v); try { localStorage.setItem('ms_side', v ? '1' : '0'); } catch { /* ignore */ } }}><Icon name="panel" size={18} />{!collapsed && 'Collapse'}</button></div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="iconbtn" style={{ display: 'none' }} aria-label={mobile ? 'Close menu' : 'Open menu'} aria-expanded={mobile} aria-controls="main-nav" onClick={() => setMobile(!mobile)} id="mobile-menu"><Icon name="menu" size={20} /></button>
            {showSearch && <Suspense fallback={<div className="sb" />}><GlobalSearch variant="bar" /></Suspense>}
            {me.tenant.demo && <span className="demo-pill" title="All customer data in this environment is fictional"><span className="t">Illustrative demo data</span></span>}
            <div className="top-right">
              
              {!supplier && plants.length > 0 && <label className="plantpick"><Icon name="pin" size={16} /><select value={plant} onChange={(e) => setPlant(e.target.value)} aria-label="Plant"><option value="">Select plant…</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.code}</option>)}</select></label>}
              {showSearch && <Link href="/search" className="iconbtn show-sm" aria-label="Search products"><Icon name="search" size={20} /></Link>}
              {!supplier && <NotificationBell />}
              {!supplier && buyer(me) && <button className="cartpill" aria-label={`Open draft requirement, ${cart?.lines?.length ?? 0} items`} onClick={() => setCartOpen(true)}><Icon name="cart" size={18} /><span className="hide-md">Requirement</span><span className="cartn" key={cart?.lines?.length ?? 0}>{cart?.lines?.length ?? 0}</span></button>}
              <div className="menu"><button className="iconbtn" style={{ padding: '0 4px' }} onClick={() => setMenu(!menu)} aria-label="Account" aria-expanded={menu}><span className="avatar">{initials}</span></button>
                {menu && <div className="menu-pop" onMouseLeave={() => setMenu(false)}><div className="who"><b>{me.name}</b><span>{me.tenant.name}</span></div><button onClick={signOut}><Icon name="logout" size={16} />Sign out</button></div>}</div>
            </div>
          </header>
          {path === '/' ? children : <div className="page">{children}</div>}
        </div>
      </div>
      <Suspense fallback={null}><ProductPanel /></Suspense>
      {cartOpen && <CartDrawer onClose={() => setCartOpen(false)} />}
      <div className="toast-float" aria-live="polite">{notices.map((n) => <div key={n.id} className={`toast ${n.error ? 'e' : n.info ? 'i' : ''}`} role={n.error ? 'alert' : 'status'}><Icon name={n.error ? 'alert' : n.info ? 'info' : 'checkCircle'} size={18} /><span>{n.text}</span>{n.href && <Link href={n.href}>{n.label ?? 'Open'}</Link>}<button className="x" aria-label="Dismiss" onClick={() => setNotices((x) => x.filter((y) => y.id !== n.id))}><Icon name="x" size={14} /></button></div>)}</div>
      <style>{`@media(max-width:900px){#mobile-menu{display:inline-flex!important}}`}</style>
    </ConfirmProvider></C.Provider>
  );
}
