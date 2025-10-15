// Import crypto polyfill FIRST before any other modules
import './crypto-polyfill';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { SeedService } from './services/seed.service';

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
  
  // CORS configuration - Allow multiple origins
  const allowedOrigins = [
    'http://localhost:3000',
    'https://pdfizzai.vercel.app',
    'https://www.pdfizzai.vercel.app',
    process.env.FRONTEND_URL,
  ].filter(Boolean); // Remove undefined values

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie'],
  });

  // Cookie parser
  app.use(cookieParser());

  // Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Run database seeder
  try {
    const seedService = app.get(SeedService);
    await seedService.seedDatabase();
  } catch (error) {
    logger.error('Failed to seed database:', error);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
