/** The Ask agent loop with a scripted LLM: tool calls run, show_products only accepts ids the tools returned, ask_user ends the turn. */
jest.mock('../src/agent/tools', () => {
  const search = { name: 'search_products', title: 'Search', description: 'search', inputSchema: { type: 'object', properties: { query: { type: 'string' }, plant_id: { type: 'string' } } },
    run: jest.fn(async (_c: any, _ctx: any, a: any) => ({ items: [{ item_id: '11111111-1111-1111-1111-111111111111', name: `match for ${a.query}`, plant: a.plant_id ?? null }] })) };
  return { TOOLS: [search], toolByName: new Map([['search_products', search]]) };
});
import { runAgent } from '../src/agent/agent';
import { TOOLS } from '../src/agent/tools';
import { specPairs, understandQuery, buildTypeIndex } from '../src/catalogue/taxonomy';

const db: any = { tx: (_ctx: any, fn: any) => fn({}) };
const ctx: any = { userId: 'u', tenantId: 't', assignments: [], kind: 'staff', supplierId: null, platform: false };
const reply = (message: any) => ({ ok: true, json: async () => ({ choices: [{ message }] }) });
const call = (id: string, name: string, args: any) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

describe('ask agent loop', () => {
  beforeEach(() => { process.env.LLM_API_KEY = 'test'; });
  it('runs tools, shows only real item ids, injects the plant and returns the final text', async () => {
    const script = [
      reply({ content: '', tool_calls: [call('a', 'search_products', { query: 'mcb 32a' })] }),
      reply({ content: '', tool_calls: [call('b', 'show_products', { item_ids: ['11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999'] })] }),
      reply({ content: 'Found a 32A MCB on a group ARC.' }),
    ];
    const bodies: any[] = [];
    (global as any).fetch = jest.fn(async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return script.shift(); });
    const out = await runAgent(db, ctx, [{ role: 'user', content: 'mcb 32a' }], { id: 'p1', name: 'Plant 1' });
    expect(out.reply).toBe('Found a 32A MCB on a group ARC.');
    expect(out.itemIds).toEqual(['11111111-1111-1111-1111-111111111111']);   // the invented id is dropped
    expect((TOOLS[0].run as jest.Mock).mock.calls[0][2].plant_id).toBe('p1');
    expect(out.steps.map((s) => s.tool)).toEqual(['search_products']);
    expect(bodies[0].tools.map((t: any) => t.function.name)).toEqual(['search_products', 'show_products', 'ask_user']);
    expect(bodies[0].messages[0].content).toContain('Plant 1');
  });
  it('stops at ask_user with the question and options', async () => {
    (global as any).fetch = jest.fn(async () => reply({ content: 'A few kinds fit.', tool_calls: [call('q', 'ask_user', { question: 'Which kind of cable?', options: ['Power cable', 'Control cable'] })] }));
    const out = await runAgent(db, ctx, [{ role: 'user', content: 'cables' }], null);
    expect(out.question).toEqual({ text: 'Which kind of cable?', options: ['Power cable', 'Control cable'] });
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });
  it('reports a provider error', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }));
    await expect(runAgent(db, ctx, [{ role: 'user', content: 'x' }], null)).rejects.toThrow('LLM 429');
  });
});

describe('query understanding', () => {
  const types = [['1', 'MCB', 'Electrical'], ['2', 'MCB BOX', 'Electrical'], ['3', 'POWER CABLE', 'Electrical'], ['4', 'CONTROL CABLE', 'Electrical'], ['5', 'CABLE GLAND', 'Electrical'],
    ['6', 'SAFETY SHOE', 'Safety & Supplies'], ['7', 'SHOE', 'Clothing & Accessories'], ['8', 'BALL BEARING', 'Bearings & Power Transmission'], ['9', 'INDUCTION MOTOR', 'Electrical']]
    .map(([id, name, category]) => ({ id, name, category, sub: '', child: '' }));
  const idx = buildTypeIndex(types); const cats = ['Electrical', 'Safety & Supplies', 'Mechanical'];
  const top = (q: string) => [...understandQuery(idx, q, cats).typeScores].sort((a, b) => b[1] - a[1]).map(([id]) => types.find((t) => t.id === id)!.name);
  it('"electrical cables" means cables, never an MCB', () => {
    const u = understandQuery(idx, 'electrical cables', cats);
    expect(u.head).toBe('cable'); expect(u.categoryHint).toBe('Electrical');
    expect(top('electrical cables')).toEqual(expect.arrayContaining(['POWER CABLE', 'CONTROL CABLE'])); expect(top('electrical cables')).not.toContain('MCB');
  });
  it('a full type name wins: mcb, safety shoes', () => {
    expect(top('mcb 32a 2 pole')[0]).toBe('MCB');
    expect(understandQuery(idx, 'safety shoes size 8', cats).exact).toEqual(['6']);
  });
  it('the thing comes before "for"', () => { expect(understandQuery(idx, 'bearings for a conveyor motor', cats).head).toBe('bearing'); });
  it('reads sizes and ratings', () => {
    expect([...specPairs('MCB 32 Amp, 2 POLE')]).toEqual(expect.arrayContaining(['32a', '2pole']));
    expect([...specPairs('CABLE,AL,4C,16MM2')]).toEqual(expect.arrayContaining(['4core', '16sqmm']));
    expect(specPairs('SAFETY SHOES 8 NO.').has('8size')).toBe(true);
  });
});
