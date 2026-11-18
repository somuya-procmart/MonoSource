import sharp from 'sharp';

/** Flat product illustrations (clearly illustrative, not photographs). Each returns an SVG string; render() makes a PNG. */
const W = 640, H = 480;
const bg = (a: string, b: string) => `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <radialGradient id="metal" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#cfd6e2"/><stop offset="1" stop-color="#8a94a6"/></radialGradient>
  <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
  <filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="#0f1728" flood-opacity=".22"/></filter></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/><ellipse cx="320" cy="410" rx="190" ry="20" fill="#0f1728" opacity=".10"/>`;
const wrap = (inner: string, a = '#eef2ff', b = '#f8fafc') => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg(a, b)}${inner}</svg>`;

export const art: Record<string, (c: string, o?: Record<string, any>) => string> = {
  bearings: (c, o = {}) => {
    const balls = Array.from({ length: 10 }, (_, i) => { const t = (i / 10) * Math.PI * 2; return `<circle cx="${320 + Math.cos(t) * 92}" cy="${215 + Math.sin(t) * 92}" r="19" fill="url(#metal)" stroke="#7b8598" stroke-width="2"/>`; }).join('');
    return wrap(`<g filter="url(#sh)"><circle cx="320" cy="215" r="150" fill="url(#metal)" stroke="#6f7a8f" stroke-width="3"/><circle cx="320" cy="215" r="122" fill="#aeb7c7"/>${balls}
      <circle cx="320" cy="215" r="66" fill="url(#metal)" stroke="#6f7a8f" stroke-width="3"/>${o.sealed ? `<circle cx="320" cy="215" r="118" fill="${c}" opacity=".55"/><circle cx="320" cy="215" r="118" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3"/>` : ''}
      <circle cx="320" cy="215" r="42" fill="#e9edf5" stroke="#6f7a8f" stroke-width="3"/><circle cx="320" cy="215" r="42" fill="url(#shade)"/></g>`);
  },
  electrical: (c, o = {}) => wrap(`<g filter="url(#sh)"><rect x="230" y="70" width="180" height="290" rx="16" fill="#f4f6fa" stroke="#aab3c4" stroke-width="3"/><rect x="230" y="70" width="180" height="40" rx="16" fill="${c}"/>
      <rect x="262" y="140" width="116" height="120" rx="10" fill="#e1e6ef" stroke="#aab3c4" stroke-width="2"/><rect x="${o.on === false ? 290 : 290}" y="${o.on === false ? 200 : 152}" width="60" height="58" rx="8" fill="${c}" stroke="#fff" stroke-width="3"/>
      <rect x="250" y="290" width="26" height="46" rx="4" fill="#9aa4b6"/><rect x="364" y="290" width="26" height="46" rx="4" fill="#9aa4b6"/><circle cx="263" cy="302" r="6" fill="#5b6475"/><circle cx="377" cy="302" r="6" fill="#5b6475"/>
      <rect x="250" y="276" width="140" height="6" fill="#c6cdd9"/><rect x="230" y="355" width="180" height="14" fill="#8a94a6"/></g>`),
  ppe: (c, o = {}) => o.kind === 'helmet'
    ? wrap(`<g filter="url(#sh)"><path d="M130 300 C130 140 230 90 320 90 C410 90 510 140 510 300 Z" fill="${c}"/><path d="M130 300 C130 140 230 90 320 90 C410 90 510 140 510 300 Z" fill="url(#shade)"/><rect x="100" y="296" width="440" height="34" rx="17" fill="${c}" stroke="#0f1728" stroke-opacity=".12" stroke-width="2"/><rect x="288" y="84" width="64" height="150" rx="22" fill="#fff" opacity=".28"/></g>`, '#fff7ed', '#fefce8')
    : wrap(`<g filter="url(#sh)" transform="rotate(-8 320 230)"><rect x="205" y="210" width="230" height="170" rx="40" fill="${c}"/><rect x="215" y="105" width="38" height="140" rx="19" fill="${c}"/><rect x="265" y="80" width="38" height="150" rx="19" fill="${c}"/><rect x="315" y="75" width="38" height="155" rx="19" fill="${c}"/><rect x="365" y="95" width="38" height="140" rx="19" fill="${c}"/>
      <rect x="150" y="215" width="40" height="110" rx="20" fill="${c}" transform="rotate(-35 170 270)"/><rect x="205" y="350" width="230" height="46" rx="12" fill="#fff" opacity=".85"/><rect x="205" y="210" width="230" height="170" rx="40" fill="url(#shade)"/></g>`, '#ecfdf5', '#f8fafc'),
  fasteners: (c) => wrap(`<g filter="url(#sh)"><polygon points="170,150 220,120 270,150 270,215 220,245 170,215" fill="url(#metal)" stroke="#6f7a8f" stroke-width="3"/><rect x="270" y="165" width="260" height="36" rx="4" fill="url(#metal)" stroke="#6f7a8f" stroke-width="3"/>
      ${Array.from({ length: 12 }, (_, i) => `<line x1="${300 + i * 18}" y1="165" x2="${312 + i * 18}" y2="201" stroke="#6f7a8f" stroke-width="3"/>`).join('')}
      <g transform="translate(0 130)"><polygon points="230,175 270,152 310,175 310,225 270,248 230,225" fill="${c}" opacity=".9" stroke="#fff" stroke-width="3"/><circle cx="270" cy="200" r="24" fill="#e6eaf2" stroke="#6f7a8f" stroke-width="3"/></g></g>`),
  valves: (c) => wrap(`<g filter="url(#sh)"><rect x="90" y="215" width="460" height="64" fill="url(#metal)" stroke="#6f7a8f" stroke-width="3"/><rect x="90" y="195" width="26" height="104" fill="#9aa4b6"/><rect x="524" y="195" width="26" height="104" fill="#9aa4b6"/>
      <ellipse cx="320" cy="250" rx="92" ry="86" fill="${c}"/><ellipse cx="320" cy="250" rx="92" ry="86" fill="url(#shade)"/><rect x="304" y="95" width="32" height="90" fill="#8a94a6"/><rect x="232" y="78" width="176" height="22" rx="11" fill="#d94841"/><circle cx="320" cy="89" r="14" fill="#8a94a6"/></g>`, '#eff6ff', '#f8fafc'),
  hoses: (c) => wrap(`<g filter="url(#sh)"><path d="M120 300 C120 130 260 110 320 220 S520 330 520 160" fill="none" stroke="#0f1728" stroke-opacity=".18" stroke-width="58" stroke-linecap="round"/><path d="M120 300 C120 130 260 110 320 220 S520 330 520 160" fill="none" stroke="${c}" stroke-width="48" stroke-linecap="round"/>
      <path d="M120 300 C120 130 260 110 320 220 S520 330 520 160" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="12" stroke-linecap="round" stroke-dasharray="3 14" transform="translate(0 -8)"/><rect x="92" y="296" width="56" height="64" rx="8" fill="url(#metal)" stroke="#6f7a8f" stroke-width="3"/><rect x="492" y="110" width="56" height="64" rx="8" fill="url(#metal)" stroke="#6f7a8f" stroke-width="3"/></g>`, '#fef2f2', '#f8fafc'),
  lubricants: (c) => wrap(`<g filter="url(#sh)"><rect x="215" y="90" width="210" height="290" rx="22" fill="${c}"/><rect x="215" y="90" width="210" height="290" rx="22" fill="url(#shade)"/><rect x="215" y="170" width="210" height="130" fill="#fff" opacity=".92"/><rect x="238" y="195" width="164" height="14" rx="7" fill="${c}"/><rect x="238" y="222" width="120" height="10" rx="5" fill="#98a2b3"/><rect x="238" y="244" width="140" height="10" rx="5" fill="#98a2b3"/>
      <rect x="285" y="62" width="70" height="40" rx="8" fill="#344054"/><rect x="305" y="40" width="30" height="30" rx="6" fill="#475467"/></g>`, '#fffbeb', '#f8fafc'),
  cables: (c) => wrap(`<g filter="url(#sh)"><circle cx="320" cy="215" r="155" fill="${c}"/><circle cx="320" cy="215" r="155" fill="url(#shade)"/>${[135, 112, 90, 70].map((r, i) => `<circle cx="320" cy="215" r="${r}" fill="none" stroke="#0f1728" stroke-opacity="${0.18 - i * 0.03}" stroke-width="10"/>`).join('')}
      <circle cx="320" cy="215" r="48" fill="url(#metal)" stroke="#6f7a8f" stroke-width="3"/><circle cx="320" cy="215" r="14" fill="#6f7a8f"/><rect x="200" y="368" width="240" height="22" rx="8" fill="#8a94a6"/></g>`, '#f0fdf4', '#f8fafc'),
  default: (c) => wrap(`<g filter="url(#sh)"><rect x="200" y="110" width="240" height="240" rx="28" fill="${c}"/><rect x="200" y="110" width="240" height="240" rx="28" fill="url(#shade)"/></g>`),
};

export async function render(category: string, color: string, opts: Record<string, any> = {}): Promise<Buffer> {
  const svg = (art[category] ?? art.default)(color, opts);
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
