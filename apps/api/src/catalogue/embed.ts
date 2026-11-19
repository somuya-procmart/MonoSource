/**
 * Text embeddings, computed inside the API (no external service: product data and queries never leave our servers).
 *
 * Model: BAAI bge-small-en-v1.5 (MIT licence, 33M parameters, 384 dimensions), 8-bit ONNX via transformers.js.
 * ~34 MB download on first use, cached in MODEL_CACHE_DIR (default ./.models; /tmp on serverless).
 * The same model must embed the taxonomy (seed) and the queries (runtime); change EMBED_MODEL only together with a re-seed.
 *
 * Set EMBEDDINGS=off to run without it: search then uses the lexical understanding alone.
 */
export const EMBED_MODEL = process.env.EMBED_MODEL || 'Xenova/bge-small-en-v1.5';
export const EMBED_DIM = 384;

let extractor: Promise<any> | null = null;
export const embeddingsEnabled = () => process.env.EMBEDDINGS !== 'off';

async function load() {
  const t = await import('@huggingface/transformers');
  t.env.cacheDir = process.env.MODEL_CACHE_DIR || (process.env.VERCEL ? '/tmp/models' : `${process.cwd()}/.models`);
  t.env.allowLocalModels = true;
  return t.pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' });
}

/** Unit-length vectors, one per text. Batches internally. */
export async function embed(texts: string[], batch = 64): Promise<number[][]> {
  if (!texts.length) return [];
  extractor ??= load().catch((e) => { extractor = null; throw e; });
  const fx = await extractor;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batch) {
    const t = await fx(texts.slice(i, i + batch).map((x) => x.toLowerCase().slice(0, 512)), { pooling: 'cls', normalize: true });
    out.push(...(t.tolist() as number[][]));
  }
  return out;
}

/** Query embedding with a small in-memory cache (people repeat searches). Returns null when embeddings are off or fail. */
const cache = new Map<string, number[]>();
export async function embedQuery(text: string): Promise<number[] | null> {
  if (!embeddingsEnabled()) return null;
  const k = text.trim().toLowerCase(); if (!k) return null;
  const hit = cache.get(k); if (hit) return hit;
  try {
    const [v] = await embed([k]);
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    cache.set(k, v); return v;
  } catch (e) { console.warn('embedding unavailable, lexical search only:', (e as Error).message); return null; }
}

export const toPgVector = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(',')}]`;

/** Text that represents a product type for embedding: its name, synonyms and where it sits. */
export const typeText = (t: { name: string; child: string; sub: string; category: string; synonyms?: string[] }) =>
  `${t.name}${t.synonyms?.length ? ' (' + t.synonyms.join(', ') + ')' : ''} — ${t.child.toLowerCase()}, ${t.category.toLowerCase()}`;
