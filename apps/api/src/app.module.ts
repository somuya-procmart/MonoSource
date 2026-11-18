import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Db } from './db/db';
import { AuthGuard } from './common/security';
import { Storage } from './storage/storage';
import { IdentityController } from './tenancy/identity.controller';
import { OrgController } from './tenancy/org.controller';
import { CatalogueController } from './catalogue/catalogue.controller';
import { SuppliersController } from './suppliers/suppliers.controller';
import { ContractsController } from './contracts/contracts.controller';
import { BuyingController } from './buying/buying.controller';
import { SourcingController } from './buying/sourcing.controller';
import { OrdersController } from './buying/orders.controller';
import { FollowUpService } from './buying/followups.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AskController } from './buying/ask.controller';
import { ExperienceController } from './catalogue/experience.controller';
import { AgenticController } from './buying/agentic.controller';
import { SourceController } from './catalogue/source.controller';
import { SimulateController } from './integrations/simulate.controller';
import { OutboxService } from './outbox/outbox.service';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');

@Module({
  imports: [
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET || 'dev-only-secret-change-me', signOptions: { expiresIn: '8h' } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT || 600) }]),
  ],
  controllers: [IdentityController, OrgController, CatalogueController, SuppliersController, ContractsController, BuyingController, SourcingController, OrdersController, AnalyticsController, AskController, ExperienceController, SourceController, AgenticController, SimulateController],
  providers: [Db, Storage, OutboxService, FollowUpService, { provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
