import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('User-Agent') || '';

    // Log the incoming request
    this.logger.log(`${method} ${originalUrl} - ${ip} - ${userAgent}`);

    // Capture the original send method
    const originalSend = res.send;
    const logger = this.logger;

    // Override the send method to log when response is sent
    res.send = function (body: any) {
      const duration = Date.now() - startTime;
      const { statusCode } = res;
      const contentLength = res.get('Content-Length') || 0;

      // Log the response
      if (statusCode >= 400) {
        logger.error(
          `${method} ${originalUrl} - ${statusCode} - ${duration}ms - ${contentLength} bytes - ${ip}`
        );
      } else {
        logger.log(
          `${method} ${originalUrl} - ${statusCode} - ${duration}ms - ${contentLength} bytes - ${ip}`
        );
      }

      // Call the original send method
      return originalSend.call(this, body);
    };

    next();
  }
}
