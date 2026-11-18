import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';

// DATE columns stay plain 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1082, (v: string) => v);

export interface TxScope {
  tenantId: string;
  platform?: boolean;
}

export const DEFAULT_APP_URL = 'postgres://monosource_app:monosource_app_dev@localhost:5432/monosource';
export const DEFAULT_ADMIN_URL = 'postgres://localhost:5432/monosource';

/**
 * All data access goes through tx(). It opens a transaction and sets the tenant
 * for Postgres row-level security, so a query can never see another tenant's rows.
 */
@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL || DEFAULT_APP_URL, max: 10 });

  async tx<T>(scope: TxScope, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.platform', $2, true)`, [
        scope.tenantId ?? '',
        scope.platform ? 'on' : 'off',
      ]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Cross-tenant access. Only for login lookup, platform admin and the job runner. */
  platformTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    return this.tx({ tenantId: '', platform: true }, fn);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
