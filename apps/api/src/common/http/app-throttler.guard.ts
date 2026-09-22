import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  override getTracker(req: Request): Promise<string> {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const email =
      typeof (req.body as Record<string, unknown>)?.['email'] === 'string'
        ? ((req.body as Record<string, string>).email || '').toLowerCase()
        : '';
    return Promise.resolve(email ? `${ip}:${email}` : ip);
  }
}