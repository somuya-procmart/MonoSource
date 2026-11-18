import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

/** Storage port. Local-disk driver only (development). An S3-compatible driver slots in here in Phase 7. */
@Injectable()
export class Storage {
  private root = resolve(process.env.STORAGE_DIR || join(process.cwd(), '.storage'));

  put(tenantId: string, buf: Buffer) {
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const key = `${tenantId}/${sha256}`;
    const dir = join(this.root, tenantId);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(this.root, key))) writeFileSync(join(this.root, key), buf);
    return { key, sha256 };
  }
  get(key: string): Buffer {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error('bad key');
    return readFileSync(p);
  }
}
