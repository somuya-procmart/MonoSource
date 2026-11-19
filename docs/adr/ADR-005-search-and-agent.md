# ADR-005: Product search, vectors, Ask agent and MCP tools

Date: 2026-11-19 · Status: accepted

## Problem
Ask MonoSource suggested an MCB for "electrical cables". The old search matched query words against the item's category text, so every item in category "Electrical" matched the word "electrical", and the 60%-of-best-score filter let them through. Search also ignored SAP abbreviations (BRG, VLV, CBL), sizes (32A, 16 sqmm) and plain-English requests.

## Decision
1. **Understand the kind of product first.** Every product type in ProcMart's category structure (3,447) has a head noun (POWER CABLE → cable, MCB → mcb). A query's head noun ("cables") selects the types; an item of another type is dropped, whatever words it shares. Full type names win ("mcb 32a 2 pole" → MCB). Category words only narrow ("electrical"). Items are classified to a type at import with the same rules (SAP "NOUN,MODIFIER" order understood).
2. **Vectors on the taxonomy, not on every item.** bge-small-en-v1.5 (MIT, 384 dims, runs inside the API via transformers.js: no data leaves, no per-call cost) embeds the 3,447 product types; pgvector HNSW. A query is embedded (~10 ms warm) and matched to types, which handles plain English ("something to cut grass" → GRASS CUTTER). Items stay lexical (full text + trigram + SAP code/part number + spec pairs), because SAP descriptions are abbreviation-heavy and embeddings score them poorly (measured: < 0.73 similarity on cryptic SAP text vs > 0.8 on English). This keeps the database under Supabase's free 500 MB; per-item vectors can be added later (`catalogue_items.embedding` exists).
3. **Ask = guided questions from the taxonomy**, no AI needed: which kind (only when kinds really split the results), then the kind's required attributes, offering only values that real items have (specs read from descriptions).
4. **Agent, provider-agnostic.** With `LLM_API_KEY` set, Ask becomes an LLM agent over any OpenAI-compatible API (Gemini default; Groq, OpenRouter, Ollama). It may only show items that a tool returned.
5. **One tool layer, two consumers**: the agent and an MCP server at `/mcp` (read-only, tenant RLS, 30-day MCP-only tokens).

## Options considered
- Embedding every item (Gemini/Voyage/OpenAI APIs, or Qwen3-Embedding/EmbeddingGemma self-hosted): better recall on English descriptions, but sends all product data out (APIs) or needs a GPU/large function (self-hosted), and ~250 MB more storage. Revisit with a paid Supabase plan.
- Supabase's built-in gte-small in Edge Functions: free and private, but a second runtime; similar quality to bge-small.
- LLM-only search (let the model pick): slow, costly, and can invent; tools + rules keep answers grounded.

## Consequences
- Search quality now depends on the taxonomy: a type missing from it (e.g. no GATE VALVE) falls back to lexical ranking, which works but cannot ask "which kind".
- 22% of items are not placed in the taxonomy (mostly services and cryptic SAP texts); they are still found lexically.
