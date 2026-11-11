import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import type { NotificationStreamEvent } from '../domain/notification.types';

/**
 * In-process real-time bus for the modular monolith. This is intentionally
 * best-effort: correctness is guaranteed by durable Notification rows and the
 * polling fallback, never by an open stream or a single process instance.
 */
@Injectable()
export class NotificationEventsService implements OnModuleDestroy {
  private readonly subject = new Subject<NotificationStreamEvent>();

  publish(event: NotificationStreamEvent): void {
    this.subject.next(event);
  }

  streamForUser(userId: string): Observable<NotificationStreamEvent> {
    return this.subject.asObservable().pipe(filter((event) => event.userId === userId));
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
