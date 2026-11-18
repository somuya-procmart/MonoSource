import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { IsArray, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Db } from '../db/db';
import { canAtNode, CurrentCtx, Ctx, Perm } from '../common/security';
import { enrichItems } from '../catalogue/catalogue.controller';
import { AskItem, AttrDef, interpretAnswers, narrow, nextQuestion, searchTokens } from './ask';

const UNITS = new Set(['mm', 'cm', 'm', 'kg', 'v', 'a', 'w', 'kw', 'hp', 'in', 'inch', 'for', 'shaft']);
class AskDto {
  @IsString() @Length(0, 300) text: string;
  @IsOptional() @IsUUID() plantId?: string;
  @IsOptional() @IsObject() answers?: Record<string, string>;
  @IsOptional() @IsArray() skipped?: string[];
}

@Controller()
export class AskController {
  constructor(private db: Db) {}

  /**
   * One turn of guided buying. Send the free text plus the answers collected so far; get back the interpreted answers,
   * the next question (if any) and the best-matching items with contract coverage and routing for the plant.
   * Prices and contract coverage come from the same engine as search: nothing here is invented.
   */
  @Perm('catalogue:read')
  @Post('ask')
  ask(@CurrentCtx() ctx: Ctx, @Body() b: AskDto) {
    return this.db.tx(ctx, async (c) => {
      if (b.plantId && !(await canAtNode(c, ctx, 'catalogue:read', b.plantId))) throw new BadRequestException('Plant not in your scope');
      const toks = searchTokens(b.text);
      if (!toks.length) return { terms: [], answers: {}, question: null, candidates: [], total: 0, done: false, message: 'Tell me what you need, for example “ball bearing for a 25 mm shaft”.' };
      const tsq = toks.map((t) => `${t}:*`).join(' | ');
      const found = (await c.query(
        `SELECT i.id, i.name, i.description, i.category, i.brand, i.mpn, i.specs FROM catalogue_items i
          WHERE i.status='active' AND (i.search @@ to_tsquery('simple', $1)
                OR EXISTS (SELECT 1 FROM jsonb_each_text(i.specs) e WHERE lower(e.value) = ANY($2))
                OR EXISTS (SELECT 1 FROM item_erp_codes ic WHERE ic.item_id=i.id AND lower(ic.material_code) = ANY($2)))
          ORDER BY ts_rank(i.search, to_tsquery('simple', $1)) DESC, i.name LIMIT 200`, [tsq, toks])).rows as (AskItem & { description?: string })[];
      // Rank by how many of the user's words an item actually matches; keep only the strong matches ("ball" alone must not pull in a ball valve).
      const wordsOnly = toks.filter((t) => !UNITS.has(t));
      const scored = found.map((it) => { const hay = `${it.name} ${it.description ?? ''} ${it.brand ?? ''} ${it.mpn ?? ''} ${it.category ?? ''} ${Object.values(it.specs ?? {}).join(' ')}`.toLowerCase(); return { it, score: wordsOnly.filter((t) => hay.includes(t)).length }; });
      const best = Math.max(0, ...scored.map((x) => x.score));
      const rows = scored.filter((x) => x.score >= Math.max(1, Math.ceil(best * 0.6))).map((x) => x.it as AskItem);
      const attrs = (await c.query(`SELECT category, key, label, required, position FROM category_attributes`)).rows as AttrDef[];
      const fromText = interpretAnswers(b.text, rows);
      const given = Object.fromEntries(Object.entries(b.answers ?? {}).filter(([k, v]) => typeof v === 'string' && v));
      const answers = { ...fromText, ...given };
      const { matching, unknownFor } = narrow(rows, answers);
      const question = nextQuestion(matching, attrs, answers, b.skipped ?? []);
      const top = matching.slice(0, 12);
      const full = top.length ? (await c.query(`SELECT i.*, (SELECT coalesce(json_agg(json_build_object('server', e.code, 'code', ic.material_code)), '[]') FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.item_id=i.id) AS codes FROM catalogue_items i WHERE i.id = ANY($1::uuid[])`, [top.map((t) => t.id)])).rows : [];
      const enriched = await enrichItems(c, top.map((t) => full.find((f) => f.id === t.id)), b.plantId ?? null);
      return {
        terms: toks, total: matching.length, matchingIds: matching.slice(0, 100).map((m) => m.id),
        answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { value: v, source: k in given ? 'you' : 'your text' }])),
        question, done: !question || matching.length <= 1,
        candidates: enriched.map((e) => ({ ...e, unknownSpecs: unknownFor.get(e.id) ?? [] })),
        message: matching.length === 0 ? 'Nothing in the catalogue matches. Try fewer details or a brand or part number.' : undefined,
      };
    });
  }
}
