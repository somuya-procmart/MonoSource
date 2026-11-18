import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db } from '../db/db';
import { audit } from '../common/security';
import { followUpAction, followUpConfig, KIND_FOR_STATUS } from './orders';

/** Communication port. Real email/WhatsApp/call providers implement this; none is wired up yet. */
export interface CommsProvider {
  send(channel: 'email' | 'whatsapp' | 'call', to: string, message: string): Promise<{ ok: boolean; detail: string; simulated: boolean }>;
}
/** ⚠ SIMULATED: nothing is actually sent. Records what would have been sent. */
export class SimulatedComms implements CommsProvider {
  async send(channel: 'email' | 'whatsapp' | 'call', to: string, message: string) {
    return { ok: true, simulated: true, detail: `SIMULATED ${channel} to ${to}: ${message}` };
  }
}

/**
 * Chases suppliers for acknowledgement, dispatch and delivery. Intervals, channels and the escalation count come
 * from the customer's own configuration; with none configured nothing is sent (no default SLA is assumed).
 * After `escalateAfter` unanswered follow-ups it raises an exception for a person instead of nagging forever.
 */
@Injectable()
export class FollowUpService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('followups'); private timer?: NodeJS.Timeout;
  provider: CommsProvider = new SimulatedComms();
  constructor(private db: Db) {}
  onModuleInit() { if (process.env.OUTBOX_WORKER !== 'off') this.timer = setInterval(() => this.scan().catch((e) => this.log.error(e.message)), 60_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async scan(now = new Date()): Promise<{ sent: number; failed: number; escalated: number }> {
    const out = { sent: 0, failed: 0, escalated: 0 };
    const tenants = await this.db.platformTx(async (c) => (await c.query(`SELECT tenant_id, thresholds FROM tenant_policies`)).rows);
    for (const t of tenants) {
      const cfg = followUpConfig(t.thresholds); if (!cfg) continue;
      await this.db.tx({ tenantId: t.tenant_id }, async (c) => {
        const streams = (await c.query(
          `SELECT st.id, st.status, st.status_at, st.requirement_id, s.contact_email, s.contact_phone, s.legal_name, r.number AS req
             FROM streams st JOIN suppliers s ON s.id=st.supplier_id JOIN requirements r ON r.id=st.requirement_id WHERE st.status = ANY($1)`, [Object.keys(KIND_FOR_STATUS)])).rows;
        for (const st of streams) {
          const kind = KIND_FOR_STATUS[st.status];
          const fu = (await c.query(`SELECT count(*)::int AS n, max(at) AS last FROM follow_ups WHERE stream_id=$1 AND kind=$2 AND at >= $3`, [st.id, kind, st.status_at])).rows[0];
          const last = fu.last && fu.last > st.status_at ? fu.last : st.status_at;
          const act = followUpAction(cfg, st.status, fu.n, new Date(last), now);
          if (act === 'escalate') {
            const open = await c.query(`SELECT 1 FROM exceptions WHERE stream_id=$1 AND kind='supplier_unresponsive' AND status='open'`, [st.id]);
            if (!open.rowCount) {
              await c.query(`INSERT INTO exceptions(tenant_id,kind,requirement_id,stream_id,detail) VALUES ($1,'supplier_unresponsive',$2,$3,$4)`, [t.tenant_id, st.requirement_id, st.id, `${st.legal_name} did not respond to ${fu.n} follow-up(s) (${kind}); escalate to the customer`]);
              await audit(c, { tenantId: t.tenant_id, userId: null }, 'followup.escalated', 'stream', st.id, { kind });
              out.escalated++;
            }
          } else if (act === 'send') {
            const channel = cfg.channels[fu.n % cfg.channels.length]; // rotate through the configured channels
            const to = channel === 'email' ? st.contact_email : st.contact_phone;
            const msg = `Reminder: order ${st.req} is waiting for your ${kind === 'ack' ? 'acknowledgement' : kind === 'dispatch' ? 'dispatch' : 'delivery confirmation'}.`;
            const res = to ? await this.provider.send(channel, to, msg) : { ok: false, simulated: true, detail: `No ${channel === 'email' ? 'email' : 'phone'} on file for the supplier` };
            await c.query(`INSERT INTO follow_ups(tenant_id,stream_id,kind,channel,status,detail,simulated) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [t.tenant_id, st.id, kind, channel, res.ok ? 'sent' : 'failed', res.detail, res.simulated]);
            await c.query(`INSERT INTO order_events(tenant_id,requirement_id,stream_id,kind,detail,simulated) VALUES ($1,$2,$3,'follow_up',$4,$5)`, [t.tenant_id, st.requirement_id, st.id, JSON.stringify({ kind, channel, ok: res.ok }), res.simulated]);
            res.ok ? out.sent++ : out.failed++;
          }
        }
      });
    }
    return out;
  }
}
