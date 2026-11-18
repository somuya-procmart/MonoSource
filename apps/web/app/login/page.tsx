'use client';
import { useState } from 'react';
import { api, setToken } from '../../lib/api';
import { Icon } from '../../components/Icon';
export default function Login() {
  const [f, setF] = useState({ tenant: '', email: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); setBusy(true); try { const { token } = await api('/auth/login', { body: f }); setToken(token); window.location.href = '/'; } catch (x: any) { setErr(x.message); setBusy(false); } };
  return <div className="hero" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}><form onSubmit={go} className="card" style={{ width: '100%', maxWidth: 410, textAlign: 'left', padding: 32, boxShadow: 'var(--sh3)' }}>
    <div className="logo" style={{ marginBottom: 22 }}><i />MonoSource</div><h1>Sign in to MonoSource</h1><p className="mut" style={{ marginBottom: 'var(--sp-6)' }}>Group procurement for every plant: find it, check the contract, raise the requirement.</p>
    {([['tenant', 'Organisation ID', 'text', 'e.g. demo'], ['email', 'Email', 'email', 'you@company.com'], ['password', 'Password', 'password', '••••••••••']] as const).map(([k, l, t, ph]) => <label key={k} className="field"><span>{l}</span><input type={t} placeholder={ph} value={f[k]} autoComplete={k === 'password' ? 'current-password' : k === 'email' ? 'username' : 'organization'} onChange={(e) => setF({ ...f, [k]: e.target.value })} required /></label>)}
    {err && <div className="toast e" role="alert"><Icon name="alert" size={18} />{err}</div>}
    <button className={`btn lg block ${busy ? 'busy' : ''}`} disabled={busy}>Sign in</button>
    <p className="mut" style={{ fontSize: 12, textAlign: 'center', margin: '16px 0 0', display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}><Icon name="shield" size={14} />Access depends on your role. Every action is recorded.</p></form></div>;
}
