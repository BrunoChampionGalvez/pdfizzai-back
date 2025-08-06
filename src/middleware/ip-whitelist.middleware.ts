import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { IPWhitelistService } from '../services/ip-whitelist.service';

@Injectable()
export class IPWhitelistMiddleware implements NestMiddleware {
  constructor(
    private ipWhitelistService: IPWhitelistService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const clientIP = this.getClientIP(req);
    const userAgent = req.headers['user-agent'];
    
    // Skip IP check for development environment
    if (process.env.NODE_ENV === 'development') {
      this.ipWhitelistService.logAccess(clientIP, true, userAgent);
      return next();
    }

    // Skip IP check for webhook endpoints (external services)
    if (req.path.startsWith('/api/webhooks')) {
      this.ipWhitelistService.logAccess(clientIP, true, `${userAgent} (WEBHOOK)`);
      return next();
    }

    // Check if the client IP is allowed
    const isAllowed = this.ipWhitelistService.isIPAllowed(clientIP);
    
    // Log the access attempt
    this.ipWhitelistService.logAccess(clientIP, isAllowed, userAgent);

    if (isAllowed) {
      return next();
    }
    
    throw new ForbiddenException('Access denied: IP not whitelisted');
  }

  private getClientIP(req: Request): string {
    // Check various headers for the real client IP
    const xForwardedFor = req.headers['x-forwarded-for'] as string;
    const xRealIP = req.headers['x-real-ip'] as string;
    const connection = req.connection?.remoteAddress;
    const socket = req.socket?.remoteAddress;
    
    // x-forwarded-for can contain multiple IPs, get the first one
    if (xForwardedFor) {
      return xForwardedFor.split(',')[0].trim();
    }
    
    if (xRealIP) {
      return xRealIP;
    }
    
    // Remove IPv6 prefix if present
    const ip = connection || socket || req.ip;
    return ip ? ip.replace('::ffff:', '') : '';
  }
}
