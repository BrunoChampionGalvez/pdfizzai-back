import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = request;
    const userAgent = request.get('User-Agent') || '';
    const startTime = Date.now();
    
    // Get the handler name for more context
    const handler = context.getHandler().name;
    const controller = context.getClass().name;

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logger.log(
          `${method} ${url} - ${controller}.${handler} - ${duration}ms - ${ip} - ${userAgent}`
        );
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error(
          `${method} ${url} - ${controller}.${handler} - ERROR: ${error.message} - ${duration}ms - ${ip} - ${userAgent}`,
          error.stack
        );
        throw error;
      })
    );
  }
}
