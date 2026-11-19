import { Controller, ForbiddenException, Get, Headers, Post } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Public } from '../common/security';
import { OutboxService } from '../outbox/outbox.service';
import { FollowUpService } from '../buying/followups.service';

/**
 * Background work for serverless hosting (Vercel), where in-process timers do not run between requests.
 * Supabase pg_cron calls this every minute (see scripts/supabase-setup.ts) with Authorization: Bearer <CRON_SECRET>.
 * Drains the outbox (simulated SAP PR/PO calls) and runs supplier follow-ups. Safe to call more often: jobs are claimed with SKIP LOCKED.
 */
@Controller('cron')
export class CronController {
  constructor(private outbox: OutboxService, private followups: FollowUpService) {}

  private check(auth?: string) {
    const secret = process.env.CRON_SECRET;
    const got = Buffer.from(String(auth ?? '')); const want = Buffer.from(`Bearer ${secret ?? ''}`);
    if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) throw new ForbiddenException();
  }

  @Public() @Get('tick') get(@Headers('authorization') a?: string) { return this.tick(a); }
  @Public() @Post('tick') async tick(@Headers('authorization') a?: string) {
    this.check(a);
    const until = Date.now() + 20_000; let jobs = 0, n = 0;
    do { n = await this.outbox.runOnce(25); jobs += n; } while (n > 0 && Date.now() < until);
    const followUps = await this.followups.scan();
    return { jobs, followUps };
  }
}
