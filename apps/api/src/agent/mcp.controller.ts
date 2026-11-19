import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Db } from '../db/db';
import { audit, CurrentCtx, Ctx, Perm } from '../common/security';
import { TOOLS, toolByName } from './tools';

/**
 * MCP server (Streamable HTTP, stateless) exposing the catalogue / taxonomy / ARC / purchase-history tools.
 *
 *   URL:   <API>/mcp            Auth:  Authorization: Bearer <token>   (POST /auth/mcp-token gives a 30-day read-only token)
 *
 * Works with Claude Desktop / Claude Code / any MCP client. Same tools as the Ask MonoSource agent. Read-only.
 */
@Controller('mcp')
export class McpController {
  constructor(private db: Db) {}

  @Perm('catalogue:read')
  @All()
  async handle(@CurrentCtx() ctx: Ctx, @Req() req: Request, @Res() res: Response) {
    const server = new Server({ name: 'monosource-catalogue', version: '1.0.0' }, {
      capabilities: { tools: {} },
      instructions: 'MonoSource: the group procurement catalogue. Find items (search_products), understand kinds of products and what to ask (browse_taxonomy, get_product_type), check group ARCs (find_arcs: a live ARC applies at every plant and the order goes to it), and see who bought what (purchase_history). Never invent items, prices or contracts: say when something is not in the data.',
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      const tool = toolByName.get(r.params.name);
      if (!tool) return { isError: true, content: [{ type: 'text' as const, text: `Unknown tool ${r.params.name}` }] };
      try {
        const out = await this.db.tx(ctx, async (c) => {
          const v = await tool.run(c, ctx, r.params.arguments ?? {});
          await audit(c, ctx, 'mcp.tool', 'tool', tool.name, { args: r.params.arguments ?? {} });
          return v;
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(out) }], structuredContent: out };
      } catch (e: any) { return { isError: true, content: [{ type: 'text' as const, text: e.message ?? String(e) }] }; }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => undefined); server.close().catch(() => undefined); });
    await server.connect(transport);
    await transport.handleRequest(req as any, res as any, (req as any).body);
  }
}
