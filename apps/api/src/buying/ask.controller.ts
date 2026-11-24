import { BadRequestException, Body, Controller, Get, Post, ServiceUnavailableException } from '@nestjs/common';
import { IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, Length, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { Db } from '../db/db';
import { audit, canAtNode, CurrentCtx, Ctx, Perm } from '../common/security';
import { enrichItems } from '../catalogue/catalogue.controller';
import { searchCatalogue } from '../catalogue/search';
import { extractSpecs, specPairs } from '../catalogue/taxonomy';
import { AskItem, AttrDef, interpretAnswers, narrow, nextQuestion, searchTokens } from './ask';
import { agentEnabled, llmConfig, runAgent } from '../agent/agent';

class AskDto {
  @IsString() @Length(0, 300) text: string;
  @IsOptional() @IsUUID() plantId?: string;
  @IsOptional() @IsObject() answers?: Record<string, string>;
  @IsOptional() @IsArray() skipped?: string[];
}
class Turn { @IsIn(['user', 'assistant']) role: 'user' | 'assistant'; @IsString() @Length(1, 4000) content: string }
class AgentDto { @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => Turn) messages: Turn[]; @IsOptional() @IsUUID() plantId?: string }

const TYPE_KEY = '__type';
/** Free-text attributes: never asked, never read from the user's words. */
const NOT_ASKED = /additional information|application|model no|part no|series|standard|drawing|remarks|description|oem/i;
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase()).replace(/\b(Mcb|Mccb|Rccb|Elcb|Led|Ups|Plc|Vfd|Hmi|Smps|Hrc|Lt|Ht|Pvc|Xlpe)\b/g, (m) => m.toUpperCase());

@Controller()
export class AskController {
  constructor(private db: Db) {}

  /** What Ask can do here: the LLM agent (when an LLM key is set) or the guided search. */
  @Perm('catalogue:read')
  @Get('ask/capabilities')
  capabilities() { return { agent: agentEnabled(), model: agentEnabled() ? llmConfig().model : null, guided: true }; }

  /**
   * One turn of guided buying (no AI). Send the text plus the answers so far; get back the next question and the best
   * items. First question, when several kinds of product fit: which kind (taxonomy). Then that kind's required
   * attributes, offering only values that real items have. Nothing is invented; items that do not record an attribute
   * stay in the list marked unknown.
   */
  @Perm('catalogue:read')
  @Post('ask')
  ask(@CurrentCtx() ctx: Ctx, @Body() b: AskDto) {
    return this.db.tx(ctx, async (c) => {
      if (b.plantId && !(await canAtNode(c, ctx, 'catalogue:read', b.plantId))) throw new BadRequestException('Plant not in your scope');
      const toks = searchTokens(b.text);
      if (!toks.length) return { terms: [], answers: {}, question: null, candidates: [], total: 0, done: false, message: 'Tell me what you need, for example “MCB 32A 2 pole” or “safety shoes size 8”.' };
      const given = Object.fromEntries(Object.entries(b.answers ?? {}).filter(([, v]) => typeof v === 'string' && v));
      const skipped = b.skipped ?? [];
      const chosenType = given[TYPE_KEY] && /^[0-9a-f-]{36}$/.test(given[TYPE_KEY]) ? given[TYPE_KEY] : null;
      const r = await searchCatalogue(c, b.text, { limit: 200, typeIds: chosenType ? [chosenType] : undefined });
      const rows = r.hits.length ? (await c.query(`SELECT i.id, i.name, left(i.description, 600) AS description, coalesce(i.product_type_id::text, i.category) AS category, i.brand, i.mpn, i.specs, t.name AS type FROM catalogue_items i LEFT JOIN taxonomy_nodes t ON t.id=i.product_type_id WHERE i.id = ANY($1::uuid[])`, [r.hits.map((h) => h.id)])).rows : [];
      const ordered: (AskItem & { type?: string })[] = r.hits.map((h) => rows.find((x) => x.id === h.id)).filter(Boolean)
        .map((x) => ({ ...x, specs: { ...(x.specs ?? {}), ...(x.brand ? { brand: x.brand } : {}) } }));

      // 1. Which kind? Only when the kinds really split the results and the user has not chosen.
      let question: any = null;
      let typed = r.types.filter((t) => t.count > 0);
      const hint = r.understanding.categoryHint;   // "electrical cables": no HDMI cables in the choice
      if (hint && typed.filter((t) => t.category === hint).length >= 2) typed = typed.filter((t) => t.category === hint);
      const typedHits = typed.reduce((s, t) => s + t.count, 0);
      const exact = typed.filter((t) => r.understanding.exact.includes(t.id));
      const dominant = exact.length === 1 ? exact[0] : typed[0] && (typed.length === 1 || typed[0].count / Math.max(1, typedHits) >= 0.8 || typed[0].score - (typed[1]?.score ?? 0) >= 0.3) ? typed[0] : null;
      // Only ask "which kind" when the kinds on offer are what the best results are (taxonomy has no GATE VALVE → just show gate valves).
      const top10 = r.hits.slice(0, 10); const covered = top10.filter((h) => typed.some((t) => t.id === h.nodeId)).length / Math.max(1, top10.length);
      if (!chosenType && !dominant && typed.length >= 2 && covered >= 0.5 && !skipped.includes(TYPE_KEY) && !skipped.includes('__all')) {
        question = { key: TYPE_KEY, label: `Which kind of ${r.understanding.head ?? 'item'}`, required: false, unknownCount: 0,
          options: [...typed].sort((x, y) => y.count - x.count).slice(0, 7).map((t) => ({ value: t.id, label: title(t.name), count: t.count })) };
      }
      const typeId = chosenType ?? dominant?.id ?? null;
      const pool = typeId ? ordered.filter((x) => x.category === typeId || !typed.some((t) => t.id === x.category)) : ordered;

      // 2. That kind's attributes (required first), from the taxonomy; brand last.
      const attrs: (AttrDef & { unit?: string | null })[] = typeId ? (await c.query(`SELECT product_type_id AS category, key, label, unit, required, position FROM product_type_attributes WHERE product_type_id=$1`, [typeId])).rows.filter((a) => !NOT_ASKED.test(a.label)) : [];
      // Items known only as "a cable" (child category) did not get this kind's specs at import: read them off the text now.
      if (typeId && attrs.length) for (const it of pool as any[]) { it.category = typeId; it.specs = { ...extractSpecs(`${it.name} ${it.description ?? ''}`, attrs as any, it.mpn), ...it.specs }; }
      if (typeId) attrs.push({ category: typeId, key: 'brand', label: 'Brand', required: false, position: 900 });
      // Tenants without the taxonomy keep their per-category question templates.
      if (!typeId) attrs.push(...(await c.query(`SELECT category, key, label, required, position FROM category_attributes WHERE category = ANY($1::text[])`, [[...new Set(pool.map((x) => x.category).filter(Boolean))]])).rows);
      // Spec values read from the text: never the words that only named the kind or the category ("electrical cables").
      const naming = new Set([r.understanding.head, ...(r.understanding.categoryHint ?? '').toLowerCase().split(/\W+/), 'electrical', 'mechanical', 'industrial'].filter(Boolean) as string[]);
      const fromText = Object.fromEntries(Object.entries(interpretAnswers(b.text, pool)).filter(([k, v]) => k !== 'type' && (!attrs.length || attrs.some((a) => a.key === k)) && !naming.has(String(v).toLowerCase().trim())));
      // Sizes/ratings written in the text ("32a 2 pole") answer the attribute whose single value they match exactly.
      const qSpecs = new Set(r.understanding.specs);
      if (qSpecs.size) for (const a of attrs) {
        if (fromText[a.key] || given[a.key]) continue;
        const vals = [...new Set(pool.map((x) => x.specs?.[a.key]).filter(Boolean))] as string[];
        const hit = vals.filter((v) => { const p = specPairs(v); return p.size > 0 && [...p].every((x) => qSpecs.has(x)); });
        if (hit.length === 1) fromText[a.key] = hit[0];
      }
      const answers = { ...fromText, ...given }; delete (answers as any)[TYPE_KEY];
      const { matching: m0, unknownFor } = narrow(pool, answers);
      const matching = [...m0].sort((x, y) => (unknownFor.get(x.id)?.length ?? 0) - (unknownFor.get(y.id)?.length ?? 0));   // fully matching first
      if (!question && !skipped.includes('__all')) question = nextQuestion(matching, attrs, answers, skipped);
      // Identifier-like attributes (model no: one item per value) are not questions anyone can answer: skip them.
      for (let guard = 0; question && question.key !== TYPE_KEY && guard < 6 && question.options.length > 5 && question.options.every((o: any) => o.count === 1); guard++)
        question = nextQuestion(matching, attrs, answers, [...skipped, question.key]);
      if (question && question.key !== TYPE_KEY) question.options = question.options.slice(0, 8);

      const top = matching.slice(0, 12);
      const full = top.length ? (await c.query(`SELECT i.*, (SELECT coalesce(json_agg(json_build_object('server', e.code, 'code', ic.material_code)), '[]') FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.item_id=i.id) AS codes FROM catalogue_items i WHERE i.id = ANY($1::uuid[])`, [top.map((t) => t.id)])).rows : [];
      const enriched = await enrichItems(c, top.map((t) => full.find((f) => f.id === t.id)), b.plantId ?? null);
      const typeName = typeId ? title(r.types.find((t) => t.id === typeId)?.name ?? rows.find((x) => x.category === typeId)?.type ?? '') : null;
      return {
        terms: toks, total: matching.length, matchingIds: matching.slice(0, 100).map((m) => m.id),
        understood: { thing: r.understanding.head, kind: typeName, sizes: r.understanding.specs, byMeaning: r.understanding.semantic },
        answers: { ...(typeName && (chosenType || dominant) ? { [TYPE_KEY]: { value: typeName, label: 'Kind', source: chosenType ? 'you' : 'your text' } } : {}),
          ...Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { value: v, label: attrs.find((a) => a.key === k)?.label ?? k, source: k in given ? 'you' : 'your text' }])) },
        question, done: !question || matching.length <= 1,
        candidates: enriched.map((e) => ({ ...e, unknownSpecs: (unknownFor.get(e.id) ?? []).map((k) => attrs.find((a) => a.key === k)?.label ?? k) })),
        message: matching.length === 0 ? 'Nothing in the catalogue matches. Try fewer details, or a brand, part number or SAP material code.' : undefined,
      };
    });
  }

  /** One turn with the Ask MonoSource agent (LLM + catalogue/ARC tools). The client keeps the conversation. */
  @Perm('catalogue:read')
  @Post('ask/agent')
  async agent(@CurrentCtx() ctx: Ctx, @Body() b: AgentDto) {
    if (!agentEnabled()) throw new ServiceUnavailableException('The Ask agent is not configured on this server (no LLM_API_KEY). Guided search is available.');
    if (!b.messages.length || b.messages[b.messages.length - 1].role !== 'user') throw new BadRequestException('The last message must be from the user');
    const plant = b.plantId ? await this.db.tx(ctx, async (c) => {
      if (!(await canAtNode(c, ctx, 'catalogue:read', b.plantId!))) throw new BadRequestException('Plant not in your scope');
      return (await c.query(`SELECT id, code || ' ' || name AS name FROM org_nodes WHERE id=$1`, [b.plantId])).rows[0] ?? null;
    }) : null;
    let out;
    try { out = await runAgent(this.db, ctx, b.messages, plant); }
    catch (e: any) { throw new ServiceUnavailableException(`The Ask agent could not answer: ${e.message}`); }
    return this.db.tx(ctx, async (c) => {
      const rows = out.itemIds.length ? (await c.query(`SELECT i.*, (SELECT coalesce(json_agg(json_build_object('server', e.code, 'code', ic.material_code)), '[]') FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.item_id=i.id) AS codes FROM catalogue_items i WHERE i.id = ANY($1::uuid[])`, [out.itemIds])).rows : [];
      const items = await enrichItems(c, out.itemIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean), b.plantId ?? null);
      await audit(c, ctx, 'ask.agent', 'ask', null as any, { model: out.model, tools: out.steps.map((s) => s.tool), items: out.itemIds.length });
      return { reply: out.reply, question: out.question, steps: out.steps, items, model: out.model };
    });
  }
}
