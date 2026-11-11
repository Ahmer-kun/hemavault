import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { defer, from, interval, map, merge, mergeMap, Observable, of } from 'rxjs';
import { CsrfGuard } from '../../auth/presentation/csrf.guard';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import { UUIDParamPipe } from '../../../common/http/uuid-param.pipe';
import type { ActorContext } from '../../rbac/domain/policy';
import { CurrentActor, RequireAnywhere } from '../../rbac/presentation/permissions.decorators';
import { NotificationService } from '../application/notification.service';
import { NotificationEventsService } from '../application/notification-events.service';
import { ListNotificationsQueryDto } from '../dto/list-notifications.query.dto';
import { UpdateNotificationPreferencesDto } from '../dto/update-notification-preferences.dto';
import { encodeNotificationEventId, NotificationView } from '../domain/notification.types';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly events: NotificationEventsService,
  ) {}

  @Get()
  @RequireAnywhere('notification.read')
  async list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ListNotificationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.notifications.listForUser(actor.userId, {
      unreadOnly: query.unreadOnly,
      type: query.type,
      limit: query.limit,
      offset: query.offset,
    });
    return { data, meta: { requestId: req.requestId } };
  }

  @Get('preferences')
  @RequireAnywhere('notification.read')
  async preferences(
    @CurrentActor() actor: ActorContext,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = { preferences: await this.notifications.getPreferences(actor.userId) };
    return { data, meta: { requestId: req.requestId } };
  }

  @Post('preferences')
  @RequireAnywhere('notification.read')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async updatePreferences(
    @CurrentActor() actor: ActorContext,
    @Body() dto: UpdateNotificationPreferencesDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = {
      preferences: await this.notifications.updatePreferences(actor.userId, dto.preferences),
    };
    return { data, meta: { requestId: req.requestId } };
  }

  @Post('read-all')
  @RequireAnywhere('notification.read')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async markAllRead(
    @CurrentActor() actor: ActorContext,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.notifications.markAllRead(actor.userId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post(':notificationId/read')
  @RequireAnywhere('notification.read')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async markRead(
    @CurrentActor() actor: ActorContext,
    @Param('notificationId', UUIDParamPipe) notificationId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.notifications.markRead(actor.userId, notificationId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Sse('stream')
  @RequireAnywhere('notification.read')
  stream(
    @CurrentActor() actor: ActorContext,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    const ready: MessageEvent = {
      type: 'ready',
      data: { userId: actor.userId, timestamp: new Date().toISOString() },
    };
    const replay = defer(() =>
      from(this.notifications.replaySince(actor.userId, lastEventId)),
    ).pipe(
      mergeMap((items) => from(items)),
      map((notification) => this.toEvent(notification)),
    );
    const live = this.events
      .streamForUser(actor.userId)
      .pipe(map((event) => this.toEvent(event.notification)));
    const keepAlive = interval(25_000).pipe(
      map<number, MessageEvent>(() => ({
        type: 'keepalive',
        data: { timestamp: new Date().toISOString() },
      })),
    );
    return merge(of(ready), replay, live, keepAlive);
  }

  private toEvent(notification: NotificationView): MessageEvent {
    return {
      id: encodeNotificationEventId(notification),
      type: 'notification.created',
      data: notification,
    };
  }
}
