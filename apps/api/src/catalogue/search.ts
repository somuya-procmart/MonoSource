import { PoolClient } from 'pg';
import { buildTypeIndex, contentWords, TypeIndex, understandQuery, words, QueryUnderstanding, isUnitToken, WEAK_HEAD, specPairs } from './taxonomy';
import { embedQuery, toPgVector } from './embed';

/**
 * Hybrid product search used by the search bar, Discover, Ask MonoSource and the MCP tools.
 *
 *  1. Understand: which product types is the user asking for? Lexical (head noun + type names + SAP abbreviations) and
 *     semantic (pgvector kNN over product types, for plain-English requests like "something to cut grass").
 *  2. Retrieve: items of those types ∪ full-text matches ∪ exact SAP material codes / part numbers ∪ typo-tolerant names.
 *  3. Rank: type fit + how many of the user's words the item really has + how often the group buys it + code hits.
 *     If the query names a kind of thing ("cables"), items of an unrelated type are dropped, however many words they share.
 */
interface CachedTaxonomy { idx: TypeIndex; categories: string[]; childOf: Map<string, string>; nodes: Map<string, { name: string; path: string; level: string; category: string }>; at: number }
const taxCache = new Map<string, CachedTaxonomy>();

export async function taxonomyFor(c: PoolClient): Promise<CachedTaxonomy> {
  const tid = (await c.query(`SELECT current_setting('app.tenant_id', true) AS t`)).rows[0].t as string;
  const hit = taxCache.get(tid); if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  const rows = (await c.query(`SELECT id, parent_id, level, name, path, category, synonyms FROM taxonomy_nodes`)).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const types = rows.filter((r) => r.level === 'product_type').map((r) => {
    const child = byId.get(r.parent_id); const sub = child ? byId.get(child.parent_id) : null;
    return { id: r.id, name: r.name, category: r.category, sub: sub?.name ?? '', child: child?.name ?? '', synonyms: r.synonyms ?? [] };
  });
  const v: CachedTaxonomy = {
    idx: buildTypeIndex(types), categories: rows.filter((r) => r.level === 'category').map((r) => r.name),
    childOf: new Map(rows.filter((r) => r.level === 'product_type').map((r) => [r.id, r.parent_id])),
    nodes: new Map(rows.map((r) => [r.id, { name: r.name, path: r.path, level: r.level, category: r.category }])), at: Date.now(),
  };
  taxCache.set(tid, v); return v;
}
export const clearTaxonomyCache = () => taxCache.clear();

export interface SearchOptions { limit?: number; typeIds?: string[]; semantic?: boolean }
export interface SearchHit { id: string; score: number; nodeId: string | null; why: string[] }
export interface TypeMatch { id: string; name: string; path: string; category: string; score: number; via: 'words' | 'meaning' | 'both'; count: number }
export interface SearchResult { understanding: QueryUnderstanding & { semantic: boolean }; types: TypeMatch[]; hits: SearchHit[]; total: number; timings: Record<string, number> }

const tsTerm = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '');

export async function searchCatalogue(c: PoolClient, text: string, o: SearchOptions = {}): Promise<SearchResult> {
  const limit = o.limit ?? 50;
  const T: Record<string, number> = {}; let t0 = Date.now(); const mark = (k: string) => { T[k] = Date.now() - t0; t0 = Date.now(); };
  const tax = await taxonomyFor(c); mark('taxonomy');
  const u = understandQuery(tax.idx, text, tax.categories);
  const typeScores = new Map(u.typeScores);
  const via = new Map<string, 'words' | 'meaning' | 'both'>([...typeScores.keys()].map((k) => [k, 'words']));

  // Semantic understanding. Skipped for code-only queries ("6205-2rs", "9643100933"), where meaning does not help.
  let semantic = false;
  const looksLikeCode = u.words.length > 0 && u.words.every((w) => /\d/.test(w));
  if (o.semantic !== false && !looksLikeCode && u.words.length) {
    const qv = await embedQuery(text); mark('embed');
    if (qv) {
      semantic = true;
      const near = (await c.query(`SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM taxonomy_nodes WHERE level='product_type' AND embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 15`, [toPgVector(qv)])).rows as { id: string; sim: number }[];
      const top = near[0]?.sim ?? 0;
      if (u.purpose) for (const [k, v] of typeScores) typeScores.set(k, v * 0.4);
      for (const n of near) {
        // absolute closeness × closeness to the best match (plain-English queries score lower overall)
        const s = Math.max(0, Math.min(1, (n.sim - 0.72) / 0.12)) * Math.max(0, Math.min(1, 1 - (top - n.sim) / 0.05)); if (!s) continue;
        const t = tax.idx.types.get(n.id); if (!t) continue;
        const had = typeScores.get(n.id);
        if (had !== undefined) { typeScores.set(n.id, Math.min(1, had + 0.25 * s)); via.set(n.id, 'both'); }
        // A different kind of thing than the head noun only on very clear meaning ("tie cables together" → cable tie).
        else if (!u.head || WEAK_HEAD.has(u.head) || (n.sim >= top - 0.01 && n.sim >= 0.83) || t.toks.includes(u.head)) { typeScores.set(n.id, (u.head && !WEAK_HEAD.has(u.head) ? 0.55 : 0.95) * s); via.set(n.id, 'meaning'); }
      }
    }
  }
  // A weak head ("machine") does not get to exclude items; a real one ("cable") does.
  if (u.head && WEAK_HEAD.has(u.head)) for (const [k, v] of typeScores) if (via.get(k) === 'words') typeScores.set(k, v * 0.6);
  if (o.typeIds?.length) for (const k of [...typeScores.keys()]) if (!o.typeIds.includes(k)) typeScores.delete(k);
  if (o.typeIds?.length) for (const k of o.typeIds) if (!typeScores.has(k)) typeScores.set(k, 1);

  // Items placed only at child-category level (the rules knew it is "a screw", not which screw) inherit a share.
  const nodeScore = new Map(typeScores);
  for (const [id, s] of typeScores) { const ch = tax.childOf.get(id); if (ch) nodeScore.set(ch, Math.max(nodeScore.get(ch) ?? 0, s * 0.6)); }

  mark('types');
  const content = contentWords(u.words);
  const terms = [...new Set(content.map(tsTerm).filter((w) => w.length >= 2))];
  const andQ = terms.length ? terms.map((w) => `${w}:*`).join(' & ') : null;
  const orQ = terms.length ? terms.map((w) => `${w}:*`).join(' | ') : null;
  const codes = [...new Set(u.codes.map((x) => x.toLowerCase()))];
  const likes = text.toLowerCase().split(/\s+/).map((w) => w.replace(/[%_\\]/g, '')).filter((w) => w.length >= 2).map((w) => `%${w}%`);
  const nodeIds = [...nodeScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k]) => k);

  // Candidate ids come from ms_search_candidates (migration 010): indexed lookups that RLS would otherwise turn into full scans.
  const cand = (await c.query(
    `WITH q AS (SELECT CASE WHEN $2::text IS NULL THEN NULL ELSE to_tsquery('simple', $2) END AS o), f AS (SELECT * FROM ms_search_candidates($1::uuid[], $3, $2, $4, $5, $6, $7, $8))
     SELECT i.id, i.name, i.keywords, i.brand, i.mpn, left(i.description, 400) AS description, i.product_type_id, i.po_lines, i.plant_count, i.category,
            CASE WHEN q.o IS NULL THEN 0 ELSE ts_rank(i.search, q.o) END AS rank, f.code_hit
       FROM f JOIN catalogue_items i ON i.id = f.id, q WHERE i.status = 'active'`,
    [nodeIds, orQ, andQ, codes, nodeIds.length === 0, text.length >= 4 && text.length <= 60, text, likes])).rows;
  mark('candidates');
  // Items found through an alias or a contract line: what people call it there counts as the item's own words.
  const viaAlias = new Map<string, string>(cand.length ? (await c.query(
    `SELECT item_id, string_agg(lower(value), ' ') v FROM item_aliases WHERE item_id = ANY($1::uuid[]) GROUP BY 1
     UNION ALL SELECT item_id, string_agg(lower(coalesce(description,'') || ' ' || coalesce(supplier_item_code,'')), ' ') FROM contract_lines WHERE item_id = ANY($1::uuid[]) AND status='published' AND supplier_item_code IS NOT NULL GROUP BY 1`,
    [cand.map((r) => r.id)])).rows.map((r) => [r.item_id, r.v]) : []);

  const head = u.head && !WEAK_HEAD.has(u.head) ? u.head : null;
  const hits: SearchHit[] = [];
  for (const r of cand) {
    const nameW = new Set(words(`${r.name} ${r.keywords} ${r.brand ?? ''} ${r.mpn ?? ''} ${viaAlias.get(r.id) ?? ''}`, { expand: 'both' }));
    const descW = new Set(words(r.description ?? '', { expand: 'both' }));
    const why: string[] = [];
    const ts = r.product_type_id ? nodeScore.get(r.product_type_id) ?? 0 : 0;
    const codeHit = r.code_hit || (r.mpn && codes.includes(String(r.mpn).toLowerCase()));
    const mpnLike = !codeHit && codes.some((cd) => String(r.mpn ?? '').toLowerCase().includes(cd) || String(r.name).toLowerCase().includes(cd));
    const hasHead = !!head && (nameW.has(head) || [...(tax.idx.byHead.get(head) ?? [])].includes(r.product_type_id));
    if (head && ts === 0 && !hasHead && !codeHit && !mpnLike) continue;               // "electrical cables" never returns an MCB
    let lex = 0, tot = 0;
    for (const w of content) { const k = u.weights[w] ?? 1; tot += k; lex += k * (nameW.has(w) ? 1 : descW.has(w) ? 0.4 : 0); }
    const lexFrac = tot ? lex / tot : 0;
    let spec = 0;
    if (u.specs.length) { const have = specPairs(`${r.name} ${r.description ?? ''}`); spec = u.specs.filter((x) => have.has(x)).length / u.specs.length; if (spec) why.push('size'); }
    if (!ts && !codeHit && !mpnLike && lexFrac < 0.5) continue;
    let score = (u.purpose ? 1.6 : 1.0) * ts + (u.purpose ? 0.6 : 1.4) * lexFrac + 0.9 * spec + 0.6 * Math.min(1, Number(r.rank) * 3) + 0.12 * Math.log10(1 + r.po_lines) + 0.05 * Math.log10(1 + r.plant_count);
    if (codeHit) { score += 3; why.push('code'); } else if (mpnLike) { score += 1.2; why.push('part number'); }
    if (u.categoryHint && r.category && r.category !== u.categoryHint) score *= 0.85;
    if (ts) why.push(r.product_type_id && tax.nodes.get(r.product_type_id)?.level === 'product_type' ? 'type' : 'kind');
    hits.push({ id: r.id, score: Math.round(score * 1000) / 1000, nodeId: r.product_type_id, why });
  }
  hits.sort((a, b) => b.score - a.score);
  const counts = new Map<string, number>();
  for (const h of hits) if (h.nodeId && typeScores.has(h.nodeId)) counts.set(h.nodeId, (counts.get(h.nodeId) ?? 0) + 1);
  const types: TypeMatch[] = [...typeScores].filter(([id]) => counts.get(id)).sort((a, b) => b[1] - a[1] || (counts.get(b[0])! - counts.get(a[0])!)).slice(0, 12)
    .map(([id, score]) => ({ id, name: tax.nodes.get(id)!.name, path: tax.nodes.get(id)!.path, category: tax.nodes.get(id)!.category, score: Math.round(score * 100) / 100, via: via.get(id) ?? 'words', count: counts.get(id)! }));
  mark('rank');
  return { understanding: { ...u, semantic }, types, hits: hits.slice(0, Math.max(limit, 1)), total: hits.length, timings: T };
}
