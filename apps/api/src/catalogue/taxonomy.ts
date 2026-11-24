/**
 * Product understanding shared by the seed (classifying items) and live search (understanding queries).
 *
 * The rule that fixes "MCB shows up for electrical cables": every product type has a HEAD NOUN (its last word:
 * POWER CABLE → cable, CABLE GLAND → gland, MCB → mcb). An item belongs to a type only when the item's own head noun
 * agrees, and a query that names a head noun ("cables") only returns items whose type has that head. Sharing a
 * top-level category ("Electrical") is never enough.
 *
 * Pure functions, no I/O: unit-tested in test/taxonomy.unit.spec.ts.
 */

/** SAP short-text abbreviations seen in the Adani material master → the words people search with. */
export const ABBREVIATIONS: Record<string, string> = {
  brg: 'bearing', brng: 'bearing', vlv: 'valve', elec: 'electrical', assy: 'assembly', cmnt: 'cement', cbl: 'cable', cabl: 'cable',
  sw: 'switch', flg: 'flange', flgd: 'flanged', gskt: 'gasket', gkt: 'gasket', ss: 'stainless steel', ms: 'mild steel', cs: 'carbon steel',
  gi: 'galvanized iron', hex: 'hexagonal', scrw: 'screw', wshr: 'washer', pmp: 'pump', fltr: 'filter', filtr: 'filter', elmt: 'element', elem: 'element',
  cplg: 'coupling', brkr: 'breaker', ckt: 'circuit', xmer: 'transformer', trfr: 'transformer', arm: 'armoured', armd: 'armoured', dgrv: 'deep groove',
  sphr: 'spherical', sph: 'spherical', tpr: 'taper', rlr: 'roller', elbw: 'elbow', rdcr: 'reducer', nipl: 'nipple', glv: 'glove', sfty: 'safety',
  hlmt: 'helmet', lmp: 'lamp', ftg: 'fitting', fitg: 'fitting', btry: 'battery', batt: 'battery', sl: 'seal', lbrcnt: 'lubricant', grs: 'grease',
  hyd: 'hydraulic', hydr: 'hydraulic', pneu: 'pneumatic', pnue: 'pneumatic', cyl: 'cylinder', implr: 'impeller', shft: 'shaft', slv: 'sleeve',
  bsh: 'bush', chn: 'chain', sprkt: 'sprocket', fdr: 'feeder', cont: 'contactor', ctr: 'contactor', insul: 'insulation', insltr: 'insulator',
  cond: 'conductor', cir: 'circuit', brk: 'breaker', brkr2: 'breaker', comp: 'compressor', sp: 'spare', lckot: 'lockout', disply: 'display', scrapper: 'scraper', triping: 'tripping', lug: 'lug', tml: 'terminal', term: 'terminal', conn: 'connector', cntr: 'connector', mtr: 'motor', ind: 'indicator', ltg: 'lighting',
  lt: 'low tension', ht: 'high tension', ac: 'ac', dc: 'dc', pvc: 'pvc', xlpe: 'xlpe', frls: 'frls', al: 'aluminium', cu: 'copper', alu: 'aluminium',
  spl: 'special', dia: 'diameter', thk: 'thickness', lg: 'length', wd: 'width', qty: 'quantity', pkt: 'packet', mcb: 'mcb', mccb: 'mccb', rccb: 'rccb',
  elcb: 'elcb', vfd: 'vfd', ups: 'ups', plc: 'plc', smps: 'smps', led: 'led', sov: 'solenoid valve', nrv: 'non return valve', prv: 'pressure reducing valve',
  bfv: 'butterfly valve', gr: 'grade', blk: 'black', wht: 'white', yel: 'yellow',
};

/** Product-type names that are acronyms or have well-known other names. Keys are normalised product type names. */
export const TYPE_SYNONYMS: Record<string, string[]> = {
  mcb: ['miniature circuit breaker'], mccb: ['moulded case circuit breaker', 'molded case circuit breaker'], rccb: ['residual current circuit breaker'],
  elcb: ['earth leakage circuit breaker'], vfd: ['variable frequency drive', 'ac drive'], ups: ['uninterruptible power supply'], plc: ['programmable logic controller'],
  smps: ['switch mode power supply'], hmi: ['human machine interface', 'operator panel'], 'power cable': ['lt cable', 'ht cable', 'armoured cable', 'xlpe cable'],
  'deep groove ball bearing': ['dgbb', '6205', '6305'], 'safety shoe': ['safety boot', 'safety footwear'], 'safety helmet': ['hard hat'],
  'cable tie': ['zip tie', 'nylon tie'], 'solenoid valve': ['sov'], 'non return valve': ['check valve', 'nrv'],
  'cutoff wheel': ['cutting wheel', 'cutting disc', 'cut off wheel', 'cut-off disc', 'wheel to cut steel and metal'], 'grinding wheel': ['grinding disc', 'dc wheel'],
  'angle grinder': ['grinding machine', 'hand grinder', 'tool to grind and cut metal'], 'flap disc': ['flap wheel disc'],
  'chain pulley block': ['chain block', 'hand hoist'], 'power contactor': ['contactor'], 'pressure gauge': ['manometer', 'pressure meter'],
  'air cylinder': ['pneumatic cylinder', 'air cylinder iso'], 'pneumatic solenoid valve': ['solenoid valve', 'sov', '5/2 valve'], 'filter regulator lubricator': ['frl', 'air service unit'],
  'wire rope': ['steel wire rope', 'crane rope'], 'flood light': ['led flood light', 'yard light'], 'induction motor': ['electric motor', 'ac motor', '3 phase motor'],
  'gland packing': ['packing rope', 'pump packing'], 'oil seal': ['shaft seal', 'lip seal'], 'industrial grease': ['bearing grease'], 'hydraulic hose': ['hydraulic pipe', 'hose pipe'],
  'variable frequency drive vfd': ['vfd', 'ac drive', 'inverter drive'], 'spiral wound gasket': ['swg', 'flange gasket'], 'proximity sensor': ['proximity switch', 'inductive sensor'],
  'electrode': ['welding rod', 'welding electrode'], 'respiratory nose mask': ['respirator', 'dust mask', 'n95'], 'loctite': ['threadlocker', 'thread locker'],
};

const STOP = new Set(['i', 'need', 'want', 'to', 'buy', 'a', 'an', 'the', 'for', 'of', 'with', 'and', 'please', 'some', 'get', 'looking', 'me', 'my',
  'we', 'our', 'in', 'on', 'pcs', 'nos', 'no', 'qty', 'quantity', 'item', 'items', 'urgent', 'urgently', 'required', 'require', 'find', 'show', 'is', 'are',
  'any', 'all', 'type', 'types', 'kind', 'existing', 'at', 'plant', 'from', 'used', 'use', 'it', 'this', 'that', 'can', 'you', 'have', 'do', 'what', 'which',
  'by', 'or', 'as', 'be', 'industrial', 'unit', 'units', 'piece', 'pieces', 'number', 'numbers', 'hsn', 'pn', 'dwg', 'drawing', 'make', 'mfr', 'model',
  'part', 'additional', 'information', 'details', 'detail', 'item', 'arc', 'contract', 'contracts', 'rate', 'price', 'cost']);
/** Words that describe a product type's use/field rather than its kind; never a head noun. */
const NOT_HEAD = new Set(['electrical', 'mechanical', 'electronic', 'industrial', 'general', 'misc', 'miscellaneous', 'spare', 'spares', 'accessory',
  'accessories', 'component', 'components', 'material', 'materials', 'item', 'parts', 'set', 'kit', 'high', 'low', 'pressure', 'heavy', 'duty', 'new', 'size']);
const UNIT = /^(\d+(\.\d+)?)(mm|cm|m|mtr|kg|g|gm|v|kv|a|ka|w|kw|hp|in|inch|sqmm|sq|bar|psi|nb|rpm|ltr|l|ml|ton|t|deg|degc|c|p|core|c)?$/;

export function singular(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is|os)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Lower-case word tokens, abbreviations expanded, plurals folded. Part-number-like tokens are kept whole. */
export function words(text: string, { expand = true as boolean | 'both', stop = false } = {}): string[] {
  const out: string[] = [];
  const raw = String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d)\s+(mm|cm|kv|kw|hp|sqmm|sq\.?\s?mm|v|a|w)\b/g, '$1$2').replace(/sq\.?\s?mm/g, 'sqmm');
  for (const t of raw.split(/[^\p{L}\p{N}.\-/+]+/u)) {
    const w = t.replace(/^[.\-/+]+|[.\-/+]+$/g, ''); if (!w) continue;
    // "BEARING-BALL" / "6322/C3": keep the whole token for part numbers, split pure-letter compounds.
    const lead = w.match(/^([a-z]{3,})[-/]([a-z]*\d.*)$/);   // "bolt-m10" → bolt, m10
    const parts = lead ? [lead[1], lead[2]] : /\d/.test(w) ? [w] : w.split(/[.\-/+]/).filter(Boolean);
    for (const p of parts) {
      if (stop && STOP.has(p)) continue;
      const ex = expand && !/\d/.test(p) ? ABBREVIATIONS[p] : undefined;
      if (ex) { if (expand === 'both' && ex !== p) out.push(p); out.push(...ex.split(' ')); } else out.push(singular(p));
    }
  }
  return out;
}

/** Abbreviations of materials/grades: they describe an item, never name it ("gate valve cs" is a valve). */
export const MATERIAL_ABBR = new Set(['ss', 'ms', 'cs', 'gi', 'al', 'cu', 'alu', 'lt', 'ht', 'gr', 'blk', 'wht', 'yel', 'pvc', 'xlpe', 'frls', 'ci']);
export const isUnitToken = (w: string) => UNIT.test(w) && !/^\d{4,}$/.test(w);   // 4+ digit numbers are part numbers (6322), not sizes
/** Generic nouns that say little about the kind of product: with these, meaning ("to cut grass") decides. */
export const WEAK_HEAD = new Set(['machine', 'equipment', 'tool', 'device', 'thing', 'something', 'product', 'unit', 'system', 'instrument', 'apparatus', 'gadget', 'stuff']);
export const contentWords = (ws: string[]) => ws.filter((w) => !isUnitToken(w) && w.length > 1 && !STOP.has(w));

export interface ProductType { id: string; name: string; category: string; sub: string; child: string; synonyms?: string[] }
export interface TypeIndex { types: Map<string, ProductType & { toks: string[]; head: string }>; byHead: Map<string, string[]>; byToken: Map<string, string[]> }

export const typeHead = (toks: string[]) => [...toks].reverse().find((t) => !NOT_HEAD.has(t) && !isUnitToken(t)) ?? toks[toks.length - 1];

export function buildTypeIndex(types: ProductType[]): TypeIndex {
  const idx: TypeIndex = { types: new Map(), byHead: new Map(), byToken: new Map() };
  for (const t of types) {
    const toks = words(t.name, { expand: false }); if (!toks.length) continue;
    const head = typeHead(toks);
    idx.types.set(t.id, { ...t, toks, head });
    (idx.byHead.get(head) ?? idx.byHead.set(head, []).get(head)!).push(t.id);
    for (const w of new Set(toks)) (idx.byToken.get(w) ?? idx.byToken.set(w, []).get(w)!).push(t.id);
    for (const syn of [...(t.synonyms ?? []), ...(TYPE_SYNONYMS[toks.join(' ')] ?? [])]) {
      const st = words(syn, { expand: false }); const sh = st.length ? typeHead(st) : '';
      if (sh && sh !== head) (idx.byHead.get(sh) ?? idx.byHead.set(sh, []).get(sh)!).push(t.id);
    }
  }
  return idx;
}

/** The noun phrase of a description. SAP style "VALVE,GATE,CS,65MM" → noun "valve", modifiers "gate cs"; prose "36 W LED FITTING" → head "fitting". */
export function nounPhrase(name: string): { head: string; noun: string[]; mods: string[]; all: string[] } {
  const s = String(name ?? '');
  const segs = s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const all = contentWords(words(s, { expand: 'both' }));
  if (segs.length > 1 && !/\d/.test(segs[0].replace(/\s/g, '').slice(0, 1))) {
    const noun = contentWords(words(segs[0], { expand: 'both' })); const mods = contentWords(words(segs.slice(1, 3).join(' '), { expand: 'both' }));
    if (noun.length) return { head: typeHead(noun), noun, mods, all };
  }
  const ws = contentWords(words(s.replace(/\(.*?\)/g, ' ').split(/\b(?:for|f\/|of|with|w\/|to suit|suitable)\b/i)[0], { expand: 'both' }));
  return { head: ws.length ? typeHead(ws) : '', noun: ws, mods: [], all };
}

export interface Classification {
  typeId: string | null;      // product type, when one is certain
  childKey: string | null;    // "category|sub|child": when only the kind is clear (a screw, but which screw?)
  score: number; basis: 'lexical' | 'head'; matched: string;
}
export const childKeyOf = (t: { category: string; sub: string; child: string }) => `${t.category}|${t.sub}|${t.child}`;

/**
 * Lexical classification of one item. A product type qualifies when every one of its words is in the item's text and
 * its head noun is the item's head noun, or (SAP "CIR BRK,MCB,32A") the type sits in the modifier. More words = more
 * specific = better ("DEEP GROOVE BALL BEARING" beats "BALL BEARING"). The ProcMart category of the item breaks ties.
 * With no full match but a known head noun, the item is placed in the child category where that noun lives.
 */
export function classify(idx: TypeIndex, name: string, opts: { category?: string | null } = {}): Classification | null {
  const np = nounPhrase(name); if (!np.head) return null;
  const have = new Set([...np.all, ...np.noun, ...np.mods]);
  const nounHeads = new Set(np.noun);
  const cands = new Set<string>();
  for (const w of [np.head, ...np.noun, ...np.mods]) for (const id of idx.byHead.get(w) ?? []) cands.add(id);
  let best: Classification | null = null;
  for (const id of cands) {
    const t = idx.types.get(id)!;
    const variants = [t.toks, ...(TYPE_SYNONYMS[t.toks.join(' ')] ?? []).map((x) => words(x, { expand: false }))];
    const m = variants.find((v) => v.every((w) => have.has(w))); if (!m) continue;
    const vh = typeHead(m);
    let score = m.length * 10;
    if (vh === np.head) score += 6; else if (nounHeads.has(vh)) score += 3;
    else if (m.length >= 2 && m.includes(np.head) && m.every((w) => nounHeads.has(w) || np.mods.slice(0, 2).includes(w))) score += 2;   // "CABLE,TIE" → CABLE TIE else if (np.mods.includes(vh) && (TYPE_SYNONYMS[t.toks.join(' ')] ?? []).some((x) => typeHead(words(x, { expand: false })) === np.head)) score += 1; else continue;
    if (np.noun.join(' ').includes(m.join(' '))) score += 4;                                // reads as the item's own name
    if (opts.category && sameCategory(opts.category, t.category)) score += 6;
    if (m.length === 1 && np.noun.length > 1 && vh === np.head) score -= 3;                 // "SEAL KIT" → prefer a 2-word type
    if (!best || score > best.score) best = { typeId: id, childKey: childKeyOf(t), score, basis: 'lexical', matched: m.join(' ') };
  }
  if (best) return best;
  // Head-only: group the types with this head by child category; the one in the item's category (or the largest) wins.
  const groups = new Map<string, { n: number; inCat: boolean }>();
  for (const id of idx.byHead.get(np.head) ?? []) {
    const t = idx.types.get(id)!; if (typeHead(t.toks) !== np.head) continue;
    const k = childKeyOf(t); const g = groups.get(k) ?? { n: 0, inCat: !!opts.category && sameCategory(opts.category, t.category) }; g.n++; groups.set(k, g);
  }
  const g = [...groups].sort((x, y) => Number(y[1].inCat) - Number(x[1].inCat) || y[1].n - x[1].n)[0];
  return g ? { typeId: null, childKey: g[0], score: 5 + (g[1].inCat ? 3 : 0), basis: 'head', matched: np.head } : null;
}

/** ProcMart's item categories and the taxonomy's top level use slightly different names. */
const CAT_ALIASES: Record<string, string[]> = {
  'it & electronics': ['i. t.', 'electronics'], bearings: ['bearings & power transmission'], 'lubricants & oils': ['lubricants & oil'],
  miscellaneous: [], insulation: ['building & construction material', 'electrical'], filters: ['mechanical', 'hydraulics & pneumatics'],
  'medical supplies': ['personal care', 'safety & supplies', 'lab supplies'],
};
export function sameCategory(itemCat: string, typeCat: string): boolean {
  const a = itemCat.toLowerCase().trim(), b = typeCat.toLowerCase().trim();
  return a === b || (CAT_ALIASES[a] ?? []).includes(b);
}

// ───────── queries ─────────
const PURPOSE_VERBS = new Set(['protect', 'cut', 'tie', 'clean', 'fix', 'measure', 'lift', 'hold', 'join', 'seal', 'cool', 'heat', 'store', 'carry', 'mark', 'test',
  'check', 'tighten', 'loosen', 'drill', 'weld', 'paint', 'pump', 'move', 'cover', 'wash', 'wipe', 'connect', 'fasten', 'grind', 'polish', 'stop', 'prevent', 'keep', 'remove', 'open', 'close', 'monitor', 'detect']);

/** Size/rating pairs written in text, normalised: "32 Amp" → 32a, "16MM2"/"16 sq mm" → 16sqmm, "4 core"/"4C" → 4core, "2 pole"/"2P" → 2pole. */
export function specPairs(text: string): Set<string> {
  const t = String(text ?? '').toLowerCase().replace(/sq\.?\s?mm|mm2|mm²/g, 'sqmm');
  const out = new Set<string>();
  const U: Record<string, string> = { a: 'a', amp: 'a', amps: 'a', ampere: 'a', v: 'v', volt: 'v', vac: 'v', vdc: 'v', kv: 'kv', ka: 'ka', w: 'w', watt: 'w', kw: 'kw', hp: 'hp', mm: 'mm', sqmm: 'sqmm',
    c: 'core', core: 'core', cores: 'core', p: 'pole', pole: 'pole', poles: 'pole', nb: 'nb', bar: 'bar', in: 'inch', inch: 'inch', '"': 'inch', kg: 'kg', kgs: 'kg', ltr: 'l', l: 'l', ton: 't', t: 't', rpm: 'rpm', m: 'm', mtr: 'm' };
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s?(sqmm|amps?|ampere|vac|vdc|kv|ka|kw|kgs?|hp|mm|nb|bar|inch|in|"|ltr|ton|rpm|mtr|cores?|poles?|watt|volt|a|v|w|c|p|l|t|m)(?![a-z])/g)) out.add(`${Number(m[1])}${U[m[2]]}`);
  const words: Record<string, string> = { single: '1', double: '2', two: '2', three: '3', four: '4', triple: '3' };
  for (const m of t.matchAll(/\b(single|double|two|three|four|triple)\s(pole|core)/g)) out.add(`${words[m[1]]}${m[2]}`);
  for (const m of t.matchAll(/\bsize\s*[:\-]?\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:no\.?|uk)(?![a-z])/g)) out.add(`${Number(m[1] ?? m[2])}size`);   // shoes, gloves: "size 8", "8 NO."
  for (const m of t.matchAll(/\b(sp|dp|tp|fp)\b/g)) out.add(`${({ sp: 1, dp: 2, tp: 3, fp: 4 } as any)[m[1]]}pole`);
  return out;
}

export interface QueryUnderstanding {
  weights: Record<string, number>;   // how much each content word matters when ranking
  exact: string[];                   // product types the query names in full ("safety shoes" → SAFETY SHOE)
  purpose: boolean;                  // phrased as what it is for ("to protect head"): meaning beats literal words
  specs: string[];                   // normalised size/rating pairs from the query
  words: string[];           // content words, expanded
  head: string | null;       // the thing being asked for ("cable")
  typeScores: Map<string, number>; // product type id → 0..1 lexical score
  categoryHint: string | null;     // a top-level category named in the query ("electrical")
  codes: string[];           // tokens that look like part numbers / material codes
}

export function understandQuery(idx: TypeIndex, text: string, categories: string[] = []): QueryUnderstanding {
  const raw = words(text, { expand: false });                       // as typed, stopwords kept (for "X for Y")
  const ws = contentWords(words(text, { expand: 'both', stop: true }));
  const have = new Set(ws);
  const codes = raw.filter((w) => /\d/.test(w) && (/[a-z\-/]/.test(w) || /^\d{4,}$/.test(w)) && !isUnitToken(w));
  let categoryHint: string | null = null;
  // A category word that is not itself a kind of product ("electrical", "safety") narrows, never selects.
  for (const c of categories) { const cw = contentWords(words(c, { expand: false })); if (cw.some((w) => have.has(w) && (NOT_HEAD.has(w) || !idx.byToken.has(w)))) { categoryHint = c; break; } }
  // Only the part before "for/with/to suit" names the thing ("bearing for a conveyor motor" → bearing, not motor).
  const cut = raw.findIndex((w, i) => i > 0 && (['for', 'with', 'suit', 'suitable', 'compatible', 'that', 'which'].includes(w) || (w === 'to' && raw[i + 1] && !['suit', 'be'].includes(raw[i + 1]))));
  const subjectRaw = (cut > 0 ? raw.slice(0, cut) : raw).filter((w) => !MATERIAL_ABBR.has(w));
  const subject = new Set(contentWords(subjectRaw.flatMap((w) => /\d/.test(w) ? [w] : words(w, { expand: 'both' }))));
  // 1. Whole product-type names in the subject win: "mcb 32a 2 pole" → MCB; "gate valve 65mm cs" → GATE VALVE.
  const typeScores = new Map<string, number>();
  let fullLen = 0; const full: string[] = [];
  for (const w of subject) for (const id of idx.byToken.get(w) ?? []) {
    const t = idx.types.get(id)!;
    const variants = [t.toks, ...(TYPE_SYNONYMS[t.toks.join(' ')] ?? []).map((x) => words(x, { expand: false }))];
    const m = variants.find((v) => v.every((x) => subject.has(x))); if (!m || NOT_HEAD.has(typeHead(m))) continue;
    if (m.length > fullLen) { fullLen = m.length; full.length = 0; } if (m.length === fullLen && !full.includes(id)) full.push(id);
  }
  let head: string | null = null;
  const purpose = raw.some((w, i) => PURPOSE_VERBS.has(w) && i < raw.length - 1);
  if (full.length) head = typeHead(idx.types.get(full[0])!.toks);
  else { // 2. otherwise the last noun of the subject that some type is about: "electrical cables" → cable
    const nouns = [...subjectRaw].reverse().flatMap((w) => /\d/.test(w) || isUnitToken(w) ? [] : words(w, { expand: true }));
    head = nouns.find((w) => idx.byHead.has(w) && !NOT_HEAD.has(w) && !STOP.has(w)) ?? null;
  }
  const consider = new Set<string>([...full, ...(head ? idx.byHead.get(head) ?? [] : [])]);
  if (!head) for (const w of subject) for (const id of idx.byToken.get(w) ?? []) consider.add(id);
  for (const id of consider) {
    const t = idx.types.get(id)!;
    if (head && typeHead(t.toks) !== head && !full.includes(id) && !(TYPE_SYNONYMS[t.toks.join(' ')] ?? []).some((x) => typeHead(words(x, { expand: false })) === head)) continue;
    const variants = [t.toks, ...(TYPE_SYNONYMS[t.toks.join(' ')] ?? []).map((x) => words(x, { expand: false }))];
    let s = 0;
    for (const v of variants) {
      const hit = v.filter((w) => have.has(w)).length; if (!hit) continue;
      // asked "power cable" → POWER CABLE 1.0; asked "cable" → POWER CABLE 0.65, CABLE 0.85
      s = Math.max(s, hit === v.length ? (v.length >= fullLen ? 1 : 0.8) : 0.45 + 0.4 * (hit / v.length));   // "shoe" inside "safety shoes": 0.8
    }
    if (full.includes(id)) s = 1;
    if (categoryHint && sameCategory(categoryHint, t.category)) s = Math.min(1, s + 0.1);
    else if (categoryHint) s *= 0.7;
    if (s > 0) typeScores.set(id, s);
  }
  // Distinguishing words the user typed for the thing ("GATE valve") matter most; material abbreviations and purpose words less.
  const weights: Record<string, number> = {};
  const matExp = new Set(raw.filter((w) => MATERIAL_ABBR.has(w)).flatMap((w) => words(w)));
  for (const w of ws) weights[w] = w === head ? 1 : matExp.has(w) || MATERIAL_ABBR.has(w) ? 0.5 : subject.has(w) ? 2 : 0.7;
  return { exact: purpose ? [] : full, purpose: purpose && !full.length, words: ws, head: purpose && !full.length ? null : head, typeScores, categoryHint, codes, weights, specs: [...specPairs(text)] };
}

// ───────── attributes (specs) from descriptions ─────────
export interface AttrSpec { key: string; label: string; unit: string | null; required: boolean }
const VALUE_WORDS: { attr: RegExp; values: [RegExp, string][] }[] = [
  { attr: /conductor material/, values: [[/\b(copper|cu)\b/, 'Copper'], [/\b(aluminium|aluminum|al)\b/, 'Aluminium']] },
  { attr: /insulation/, values: [[/\bxlpe\b/, 'XLPE'], [/\bpvc\b/, 'PVC'], [/\bepr\b/, 'EPR'], [/\bfrls\b/, 'FRLS']] },
  { attr: /armou?ring/, values: [[/\bunarm|unarmou?red\b|\b[un]-arm\b|\bnon[- ]?arm/, 'Unarmoured'], [/\barmou?red\b|\barm\b/, 'Armoured']] },
  { attr: /^(material|moc|body material|material of construction)$/, values: [[/\bss ?316l?\b|stainless steel 316/, 'SS316'], [/\bss ?304\b|stainless steel 304/, 'SS304'], [/\bss\b|stainless steel/, 'Stainless steel'], [/\bms\b|mild steel/, 'Mild steel'], [/\bcs\b|carbon steel/, 'Carbon steel'], [/\bgi\b|galvani[sz]ed/, 'GI'], [/\bcast iron|\bci\b/, 'Cast iron'], [/\bbrass\b/, 'Brass'], [/\bpvc\b/, 'PVC'], [/\bhdpe\b/, 'HDPE'], [/\bnylon\b/, 'Nylon']] },
  { attr: /^(type|end connection|connection type)$/, values: [[/\bflg|flanged?\b/, 'Flanged'], [/\bscrewed|threaded|bsp|npt\b/, 'Threaded'], [/\bsw\b|socket weld/, 'Socket weld'], [/\bbw\b|butt weld/, 'Butt weld']] },
  { attr: /tripping curve/, values: [[/\b([bcd])[- ]?curve\b|\bcurve[- ]?([bcd])\b/, '$curve']] },
];
const UNIT_RX: Record<string, RegExp> = {
  V: /\b(\d{2,5}(?:\.\d+)?)\s?v(?:ac|dc)?\b/, KV: /\b(\d{1,3}(?:\.\d+)?)\s?kv\b/, A: /\b(\d{1,4}(?:\.\d+)?)\s?a(?:mp|mps)?\b/, KA: /\b(\d{1,3}(?:\.\d+)?)\s?ka\b/,
  W: /\b(\d{1,5}(?:\.\d+)?)\s?w(?:att)?s?\b/, KW: /\b(\d{1,4}(?:\.\d+)?)\s?kw\b/, HP: /\b(\d{1,4}(?:\.\d+)?)\s?hp\b/, SQMM: /\b(\d{1,4}(?:\.\d+)?)\s?(?:sq\.?\s?mm|sqmm|mm2|sq)\b/,
  RPM: /\b(\d{3,5})\s?rpm\b/, BAR: /\b(\d{1,4}(?:\.\d+)?)\s?bar\b/, NB: /\b(\d{2,4})\s?nb\b/, INCH: /\b(\d{1,2}(?:\.\d+|\/\d)?)\s?(?:"|inch|in)\b/,
  LTR: /\b(\d{1,5}(?:\.\d+)?)\s?(?:ltr|l|litre|liter)s?\b/, KG: /\b(\d{1,5}(?:\.\d+)?)\s?kgs?\b/, MTR: /\b(\d{1,5}(?:\.\d+)?)\s?(?:mtr|m|meter|metre)s?\b/,
};
/** Values for the product type's attributes that can be read off the text with certainty. Unclear → left out (asked, not guessed). */
export function extractSpecs(text: string, attrs: AttrSpec[], mpn?: string | null): Record<string, string> {
  const t = ' ' + String(text ?? '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const out: Record<string, string> = {};
  const byUnit = new Map<string, AttrSpec[]>();
  for (const a of attrs) if (a.unit) (byUnit.get(a.unit.toUpperCase()) ?? byUnit.set(a.unit.toUpperCase(), []).get(a.unit.toUpperCase())!).push(a);
  for (const [unit, list] of byUnit) {
    const rx = UNIT_RX[unit === 'KGS' ? 'KG' : unit]; if (!rx || list.length !== 1) continue;  // two MM attributes: can't tell which is which
    const m = t.match(rx); if (m) out[list[0].key] = `${m[1]} ${unit === 'SQMM' ? 'sq mm' : unit.toLowerCase() === 'inch' ? 'inch' : unit === 'KV' || unit === 'KW' || unit === 'KA' || unit === 'HP' || unit === 'RPM' ? unit.toLowerCase().replace(/^k/, 'k').toUpperCase() : unit}`.replace(/ (V|A|W)$/, '$1').replace(/ KG$/, ' kg');
  }
  for (const a of attrs) {
    const label = a.label.toLowerCase();
    if (/no\.? of poles|number of poles|poles/.test(label)) { const m = t.match(/\b([1-4])\s?(?:p|pole|poles)\b|\b(sp|dp|tp|fp|tpn)\b/); if (m) out[a.key] = m[1] ? `${m[1]}P` : ({ sp: '1P', dp: '2P', tp: '3P', fp: '4P', tpn: '3P+N' } as any)[m[2]]; }
    if (/number of cores|no of cores|cores/.test(label)) { const m = t.match(/\b(\d{1,2}(?:\.\d)?)\s?(?:c|core|cores)\b|\b(\d{1,2})\s?x\s?\d/); if (m) out[a.key] = `${m[1] ?? m[2]} core`; }
    if (/^model no|^part no|^part number/.test(label) && mpn) out[a.key] = mpn;
    for (const vw of VALUE_WORDS) if (vw.attr.test(label)) for (const [rx, v] of vw.values) { const m = t.match(rx); if (m) { out[a.key] = v === '$curve' ? `${(m[1] ?? m[2]).toUpperCase()} curve` : v; break; } }
  }
  // "KEY : VALUE KEY2 : VALUE2" written out in the SAP long text: a value runs until the next known label
  const fields = labelledFields(t, attrs);
  for (const a of attrs) {
    if (out[a.key] || JUNK_ATTR.test(a.label.toLowerCase())) continue;
    let v = fields.get(a.label.toLowerCase()); if (!v) continue;
    const unit = a.unit?.toLowerCase();
    if (unit) {   // "170 MM LENGTH" → 170 MM, "50" → 50 MM; a value that is no measure in this unit is left out
      const m = v.match(/^(\d+(?:\.\d+)?(?:\s?(?:x|\/|-)\s?\d+(?:\.\d+)?)*)\s?([a-z/%"²]+)?/);
      if (!m) continue;
      const u = (m[2] ?? '').replace(/s$/, '');
      if (u && !unitMatches(u, unit)) continue;
      v = `${m[1].replace(/\s/g, '')} ${a.unit}`;
    } else if (v.replace(/[^a-z0-9]/g, '').length < 2 || /^\d$/.test(v)) continue;
    out[a.key] = v.toUpperCase();
  }
  return out;
}

/** Labels that carry no spec of their own ("ADDITIONAL INFORMATION : SPARE"). */
const JUNK_ATTR = /^(additional information|additional info|remarks?|others?|notes?|description|specifications?|details?)$/;
/** Labels SAP long texts use besides the product type's attributes: a value ends where one of these starts. */
const TEXT_LABELS = ['manufacturer', 'make', 'mfr', 'brand', 'model number', 'model no', 'model', 'part number', 'part no', 'oem part name', 'oem part number',
  'drawing number', 'drawing no', 'dwg no', 'dwg', 'catalogue number', 'catalog number', 'cat no', 'additional information', 'additional info', 'serial number',
  'equipment', 'application', 'size', 'material', 'type', 'standard', 'grade', 'rating', 'capacity', 'ba', 'mm', 'pn', 'cat', 'ref', 'item'];
/** Words that end a value even without a colon after them: "40 MM TIMKEN MAKE BEARING". */
const VALUE_STOP = /\s(?:make|mfr|manufacturer|model|part no|part number|drawing|dwg|oem|additional|cat no|catalogue)\b.*$/;
const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function labelledFields(t: string, attrs: AttrSpec[]): Map<string, string> {
  const labels = [...new Set([...attrs.map((a) => a.label.toLowerCase()), ...TEXT_LABELS])].sort((x, y) => y.length - x.length);
  const rx = new RegExp(`(?<![a-z0-9])(${labels.map(escRx).join('|')})\\s*[:=]`, 'g');
  const hits = [...t.matchAll(rx)];
  const out = new Map<string, string>();
  hits.forEach((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index! : t.length;
    let v = t.slice(h.index! + h[0].length, end).trim();
    v = v.split(/\s{2,}|[,;]/)[0].replace(VALUE_STOP, '').trim();
    // an unknown label follows ("13 MM THICKNESS:8 MM", "SPHERICAL ROWS : DOUBLE"): the value ends before its last word
    const next = v.search(/\s+[a-z][a-z0-9.]*\s*[:=]/); if (next >= 0) v = v.slice(0, next);
    // a measurement followed by more words: keep the measurement ("600 MM WORKING PRESSURE" → 600 MM)
    const meas = v.match(/^\d[\d.]*(?:\s?(?:x|\/|-)\s?\d[\d.]*)*\s?(?:mm|cm|m|mtr|in|inch|kg|kgs|bar|v|a|w|kw|kv|hp|rpm|sq ?mm|mm2|l|ltr|ml|nb)\b(?=\s+[a-z])/);
    if (meas) v = meas[0];
    v = v.replace(/[\s.\-:=]+$/, '');
    if (v.length > 40) v = v.slice(0, 40).replace(/\s+\S*$/, '');
    if (v && !out.has(h[1])) out.set(h[1], v);
  });
  return out;
}

const UNIT_WORDS: Record<string, string[]> = { mm: ['mm'], m: ['m', 'mtr', 'meter', 'metre'], mtr: ['m', 'mtr', 'meter', 'metre'], inch: ['inch', 'in', '"'],
  kg: ['kg', 'kgs'], kgs: ['kg', 'kgs'], v: ['v', 'vac', 'vdc', 'volt'], a: ['a', 'amp', 'amps'], w: ['w', 'watt'], kw: ['kw'], kv: ['kv'], hp: ['hp'], rpm: ['rpm'],
  bar: ['bar'], ltr: ['l', 'ltr', 'litre', 'liter'], sqmm: ['sqmm', 'sq', 'mm2', 'mm²'], nb: ['nb'], micron: ['micron', 'mic', 'µm'] };
const unitMatches = (u: string, unit: string) => (UNIT_WORDS[unit] ?? [unit]).includes(u);

export const attrKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
