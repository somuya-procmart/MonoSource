import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

/**
 * File storage (contract documents, product images). Content-addressed: key = <tenant>/<sha256>.
 *
 *  - Supabase Storage when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (production; serverless has no lasting disk).
 *    Bucket STORAGE_BUCKET (default "monosource"), private: files are only ever served through the API, which checks
 *    tenant and permissions first. The service-role key stays on the server.
 *  - Local disk otherwise (development), under STORAGE_DIR (default ./.storage).
 */
@Injectable()
export class Storage {
  private root = resolve(process.env.STORAGE_DIR || join(process.cwd(), '.storage'));
  private sb = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? { url: process.env.SUPABASE_URL.replace(/\/$/, ''), key: process.env.SUPABASE_SERVICE_ROLE_KEY, bucket: process.env.STORAGE_BUCKET || 'monosource' } : null;

  async put(tenantId: string, buf: Buffer) {
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const key = `${tenantId}/${sha256}`;
    if (this.sb) {
      const r = await fetch(`${this.sb.url}/storage/v1/object/${this.sb.bucket}/${key}`, {
        method: 'POST', headers: { authorization: `Bearer ${this.sb.key}`, apikey: this.sb.key, 'content-type': 'application/octet-stream', 'x-upsert': 'true' }, body: new Uint8Array(buf),
      });
      if (!r.ok) throw new Error(`File storage failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
      return { key, sha256 };
    }
    const dir = join(this.root, tenantId);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(this.root, key))) writeFileSync(join(this.root, key), buf);
    return { key, sha256 };
  }

  async get(key: string): Promise<Buffer> {
    if (!/^[0-9a-f-]{36}\/[0-9a-f]{64}$/.test(key)) throw new Error('bad key');
    if (this.sb) {
      const r = await fetch(`${this.sb.url}/storage/v1/object/authenticated/${this.sb.bucket}/${key}`, { headers: { authorization: `Bearer ${this.sb.key}`, apikey: this.sb.key } });
      if (!r.ok) throw new Error(`File not available (${r.status})`);
      return Buffer.from(await r.arrayBuffer());
    }
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error('bad key');
    return readFileSync(p);
  }
}
