import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { validateEnv } from './common/config/env.schema';
import { AppConfigModule } from './common/config/app-config.module';
import { PrismaModule } from './common/database/prisma.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { requestIdMiddleware } from './common/http/request-id.middleware';
import { AppThrottlerGuard } from './common/http/app-throttler.guard';
import { HealthModule } from './modules/health/health.module';
import { MetaModule } from './modules/meta/meta.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/presentation/auth.guard';
import { RbacModule } from './modules/rbac/rbac.module';
import { PermissionsGuard } from './modules/rbac/presentation/permissions.guard';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { UsersModule } from './modules/users/users.module';
import { DonorsModule } from './modules/donors/donors.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { DonationsModule } from './modules/donations/donations.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { RequestsModule } from './modules/requests/requests.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    AppConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    HealthModule,
    MetaModule,
    AuthModule,
    RbacModule,
    OrganizationsModule,
    FacilitiesModule,
    UsersModule,
    DonorsModule,
    CampaignsModule,
    DonationsModule,
    InventoryModule,
    RequestsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: true }),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(requestIdMiddleware, cookieParser())
      .forRoutes('*');
  }
}