/**
 * Ask MonoSource: guided buying by progressive questions. Pure and deterministic (no AI needed), so it is testable and
 * can never invent a specification: it only offers values that exist on catalogue items, and items that do not record an
 * attribute stay in the list marked "unknown" instead of being dropped or guessed.
 */
export interface AskItem { id: string; name: string; category: string | null; brand?: string | null; mpn?: string | null; specs: Record<string, string> }
export interface AttrDef { category: string; key: string; label: string; required: boolean; position: number }
export interface Question { key: string; label: string; required: boolean; options: { value: string; count: number }[]; unknownCount: number }

const STOP = new Set(['i', 'need', 'want', 'to', 'buy', 'a', 'an', 'the', 'for', 'of', 'with', 'and', 'please', 'some', 'get', 'looking', 'me', 'my', 'we', 'our', 'in', 'on', 'pcs', 'nos']);
export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '').trim();
export const tokens = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}.\-/]+/u).filter((t) => t && !STOP.has(t));

/** Search tokens used to retrieve candidates (the SQL layer ORs them). */
export function searchTokens(text: string): string[] { return tokens(text).map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter((t) => t.length >= 2); }

/** Attribute values stated in the user's text, e.g. "25 mm bore" → bore=25 when some item has bore "25". Only existing values; only unambiguous. */
export function interpretAnswers(text: string, items: AskItem[]): Record<string, string> {
  const hay = ' ' + text.toLowerCase().replace(/(\d)\s+(mm|cm|m|kg|v|a|w|kw|hp|in|inch)\b/g, '$1$2') + ' ';
  const found: Record<string, Set<string>> = {};
  for (const it of items) for (const [k, v] of Object.entries(it.specs ?? {})) {
    const nv = String(v).toLowerCase().trim(); if (!nv) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}.])${nv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}(?:mm|cm|v|a|w|kw|hp)?(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(hay)) (found[k] ??= new Set()).add(String(v));
  }
  const out: Record<string, string> = {};
  for (const [k, vs] of Object.entries(found)) if (vs.size === 1) out[k] = [...vs][0]; // ambiguous mentions are left for a question
  return out;
}

export function narrow(items: AskItem[], answers: Record<string, string>): { matching: AskItem[]; unknownFor: Map<string, string[]> } {
  const unknownFor = new Map<string, string[]>(); const matching: AskItem[] = [];
  for (const it of items) {
    let ok = true; const unk: string[] = [];
    for (const [k, v] of Object.entries(answers)) {
      const have = it.specs?.[k];
      if (have === undefined || have === '') unk.push(k);
      else if (norm(have) !== norm(v)) { ok = false; break; }
    }
    if (ok) { matching.push(it); if (unk.length) unknownFor.set(it.id, unk); }
  }
  return { matching, unknownFor };
}

/** Required attributes first (template order), then whichever attribute splits the remaining items best. */
export function nextQuestion(items: AskItem[], attrs: AttrDef[], answers: Record<string, string>, skipped: string[] = []): Question | null {
  if (items.length <= 1) return null;
  const cats = new Set(items.map((i) => i.category).filter(Boolean));
  const tpl = attrs.filter((a) => cats.has(a.category));
  const keys = new Map<string, { label: string; required: boolean; position: number }>();
  for (const a of tpl) keys.set(a.key, { label: a.label, required: a.required, position: a.position });
  for (const it of items) for (const k of Object.keys(it.specs ?? {})) if (!keys.has(k)) keys.set(k, { label: k.replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), required: false, position: 999 });
  const cands: (Question & { split: number; position: number })[] = [];
  for (const [key, meta] of keys) {
    if (key in answers || skipped.includes(key)) continue;
    const counts = new Map<string, number>(); let unknown = 0;
    for (const it of items) { const v = it.specs?.[key]; if (v === undefined || v === '') unknown++; else counts.set(String(v), (counts.get(String(v)) ?? 0) + 1); }
    if (counts.size < 2) continue; // nothing to choose between
    cands.push({ key, label: meta.label, required: meta.required, unknownCount: unknown, options: [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
      split: Math.max(...counts.values()), position: meta.position });
  }
  cands.sort((a, b) => Number(b.required) - Number(a.required) || a.position - b.position || a.split - b.split || a.key.localeCompare(b.key));
  const q = cands[0]; if (!q) return null;
  const { split, position, ...rest } = q; void split; void position; return rest;
}
