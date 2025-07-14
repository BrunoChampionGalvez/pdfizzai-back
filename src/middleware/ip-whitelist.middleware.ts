import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Reflector } from '@nestjs/core';
import { IPWhitelistService } from '../services/ip-whitelist.service';
import { SKIP_IP_WHITELIST_KEY } from '../decorators/skip-ip-whitelist.decorator';

@Injectable()
export class IPWhitelistMiddleware implements NestMiddleware {
  constructor(
    private ipWhitelistService: IPWhitelistService,
    private reflector: Reflector,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const clientIP = this.getClientIP(req);
    const userAgent = req.headers['user-agent'];
    
    // Skip IP check for development environment
    if (process.env.NODE_ENV === 'development') {
      this.ipWhitelistService.logAccess(clientIP, true, userAgent);
      return next();
    }

    // Check if route has skip whitelist decorator
    const skipWhitelist = this.reflector.get<boolean>(
      SKIP_IP_WHITELIST_KEY,
      req.route?.stack?.[0]?.handle,
    );

    if (skipWhitelist) {
      this.ipWhitelistService.logAccess(clientIP, true, `${userAgent} (SKIPPED)`);
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
