'use client';
import { useEffect, useState } from 'react';
import { API, getToken } from '../lib/api';
/** Images are protected by the API, so they are fetched with the session token and shown from a blob URL. */
export function AuthImage({ assetId, fallback, alt = '', style }: { assetId?: string | null; fallback: React.ReactNode; alt?: string; style?: React.CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!assetId) { setSrc(null); return; }
    let url = ''; let dead = false;
    fetch(`${API}/catalogue/assets/${assetId}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject())).then((b) => { if (!dead) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => setSrc(null));
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [assetId]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'relative', ...style }} /> : <>{fallback}</>;
}
