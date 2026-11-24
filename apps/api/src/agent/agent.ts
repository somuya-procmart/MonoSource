import { Db } from '../db/db';
import { Ctx } from '../common/security';
import { TOOLS, toolByName } from './tools';

/**
 * Ask MonoSource agent. Provider-agnostic: any OpenAI-compatible chat-completions API with tool calling.
 *
 *   LLM_API_KEY   required to turn the agent on (without it Ask uses the deterministic guided search)
 *   LLM_BASE_URL  default Google Gemini's OpenAI-compatible endpoint. Others:
 *                   Groq        https://api.groq.com/openai/v1          (e.g. openai/gpt-oss-120b, qwen/qwen3-32b)
 *                   OpenRouter  https://openrouter.ai/api/v1
 *                   Ollama      http://localhost:11434/v1               (fully local, e.g. qwen3:8b)
 *   LLM_MODEL     default gemini-2.5-flash
 *
 * Privacy: the user's messages and the tool results (catalogue rows, ARC numbers, PO summaries) go to that provider.
 * Free tiers of some providers may use data to improve their products: use a paid tier or a local model for real data.
 */
export const llmConfig = () => ({
  key: process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || '',
  base: (process.env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, ''),
  model: process.env.LLM_MODEL || 'gemini-2.5-flash',
});
export const agentEnabled = () => !!llmConfig().key;

const UI_TOOLS = [
  { type: 'function', function: { name: 'show_products', description: 'Show product cards to the user (with live contract coverage and an add-to-requirement button). Use item_ids returned by search_products/get_product only, best first, at most 6.',
    parameters: { type: 'object', properties: { item_ids: { type: 'array', items: { type: 'string' } } }, required: ['item_ids'] } } },
  { type: 'function', function: { name: 'ask_user', description: 'Ask ONE short clarifying question with 2-6 tappable answers when the need is ambiguous (e.g. which kind, which rating). Ends your turn.',
    parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question', 'options'] } } },
];

const SYSTEM = (plant: string | null) => `You are Ask MonoSource, the buying assistant of the Adani group's procurement platform (run by ProcMart).
Help a requester find the exact catalogue item they need and tell them how it can be bought.

How to work:
- Always use the tools. Never invent items, part numbers, prices, vendors or contracts. If the data does not have it, say so.
- First understand WHAT kind of product is meant. If several kinds fit ("cable" could be power, control or instrumentation cable), use browse_taxonomy or the productTypes from search_products and ask_user which kind, unless the message already makes it clear.
- Then search with the user's specs (ratings, sizes, material) in the query. If the product type has required attributes the user has not given (get_product_type), ask for the most important missing one with ask_user, offering values actually seen.
- Prefer items with a live ARC. Group rule: ARCs are group-level; a live ARC applies at every plant and the order must go to it. Ordering also needs the ARC vendor to have a code on the plant's SAP server ("orderableAtPlant").
- No ARC → ProcMart sources it (quotes). ARC rates are held in SAP, not in MonoSource: never quote a price.
- When you have good matches, call show_products with the best ids, then reply in 1-3 short sentences: what you found and how it can be bought. No tables, no long lists; the cards show the details.
- Plain words. The user is a plant requester, not a data analyst. Do not mention tool names.
${plant ? `The user is buying for plant: ${plant}. Pass its plant_id to tools.` : 'No plant selected yet: coverage is shown group-wide; suggest picking a plant to order.'}`;

export interface AgentTurn { role: 'user' | 'assistant'; content: string }
export interface AgentResult { reply: string; itemIds: string[]; question: { text: string; options: string[] } | null; steps: { tool: string; label: string }[]; model: string }

const LABEL: Record<string, string> = { search_products: 'Searched the catalogue', get_product: 'Read product details', find_arcs: 'Checked group ARCs', browse_taxonomy: 'Looked up product types',
  get_product_type: 'Checked what specs matter', purchase_history: 'Checked purchase history', list_plants: 'Looked up plants', catalogue_overview: 'Checked the catalogue' };

export async function runAgent(db: Db, ctx: Ctx, history: AgentTurn[], plant: { id: string; name: string } | null): Promise<AgentResult> {
  const cfg = llmConfig();
  const messages: any[] = [{ role: 'system', content: SYSTEM(plant ? `${plant.name} (plant_id ${plant.id})` : null) }, ...history.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))];
  const tools = [...TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })), ...UI_TOOLS];
  const steps: AgentResult['steps'] = []; let itemIds: string[] = []; let question: AgentResult['question'] = null;
  const seen = new Set<string>();   // item ids the tools actually returned: show_products may only use these
  for (let round = 0; round < 7; round++) {
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const msg = (await res.json()).choices?.[0]?.message;
    if (!msg) throw new Error('LLM returned no message');
    const calls: any[] = msg.tool_calls ?? [];
    messages.push({ role: 'assistant', content: msg.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) return { reply: String(msg.content ?? '').trim(), itemIds, question, steps, model: cfg.model };
    for (const call of calls) {
      const name = call.function?.name; let args: any = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* bad JSON → empty args */ }
      let out: any;
      if (name === 'show_products') { itemIds = [...new Set((args.item_ids ?? []).filter((x: string) => seen.has(x)))].slice(0, 6) as string[]; out = { shown: itemIds.length }; }
      else if (name === 'ask_user') { question = { text: String(args.question ?? '').slice(0, 200), options: (args.options ?? []).map(String).slice(0, 6) }; out = { asked: true }; }
      else {
        const tool = toolByName.get(name);
        try {
          if (!tool) throw new Error(`unknown tool ${name}`);
          if (plant && 'plant_id' in (tool.inputSchema.properties ?? {}) && !args.plant_id) args.plant_id = plant.id;
          out = await db.tx(ctx, (c) => tool.run(c, ctx, args));
          JSON.stringify(out).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)?.forEach((x) => seen.add(x));
          steps.push({ tool: name, label: LABEL[name] ?? name });
        } catch (e: any) { out = { error: e.message ?? String(e) }; }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(out).slice(0, 12_000) });
    }
    if (question) return { reply: String(msg.content ?? '').trim(), itemIds, question, steps, model: cfg.model };
  }
  return { reply: 'I could not finish that in time. Try saying it more specifically.', itemIds, question, steps, model: cfg.model };
}
