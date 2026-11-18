'use client';
export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function getToken(): string | null {
  try { return localStorage.getItem('ms_token'); } catch { return null; }
}
export function setToken(t: string | null) {
  try { t ? localStorage.setItem('ms_token', t) : localStorage.removeItem('ms_token'); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method: opts.method || (opts.body || opts.form ? 'POST' : 'GET'), headers, body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && !path.startsWith('/auth/')) { setToken(null); if (typeof window !== 'undefined') window.location.href = '/login'; }
  if (!res.ok) {
    const m = data?.message;
    throw new ApiError(res.status, Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : res.statusText, data);
  }
  return data as T;
}
