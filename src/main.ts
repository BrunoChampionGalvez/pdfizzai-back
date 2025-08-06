// Import crypto polyfill FIRST before any other modules
import './crypto-polyfill';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    logger: ['log', 'error', 'warn', 'debug', 'verbose'], // Enable all log levels
  });
  
  // Configure body parser limits for file uploads
  app.use(require('express').json({ limit: '100mb' }));
  app.use(require('express').urlencoded({ limit: '100mb', extended: true }));
  
  // Security
  app.use(helmet());
  
  // CORS configuration - simplified since IP whitelisting is handled by middleware
  app.enableCors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      // Allow requests from whitelisted IPs
      /^https?:\/\/(34\.194\.127\.46|54\.234\.237\.108|3\.208\.120\.145|44\.226\.236\.210|44\.241\.183\.62|100\.20\.172\.113)/
    ],
    credentials: true,
  });

  // Cookie parser
  app.use(cookieParser());

  // Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
