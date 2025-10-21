const serverless = require('serverless-http');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

let cachedApp;
let isSeeded = false;

async function bootstrap() {
  // DEBUG: Ver qué variables de entorno llegan
  console.log('=== ENVIRONMENT VARIABLES ===');
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('===========================');
  
  if (cachedApp) {
    return cachedApp;
  }

  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    logger: ['error', 'warn', 'log'], // Reduce logging in Lambda
  });

  // Configure body parser limits for file uploads
  const express = require('express');
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Security
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));

  // CORS configuration - Allow multiple origins
  const allowedOrigins = [
    'http://localhost:3000',
    'https://pdfizzai.vercel.app',
    'https://www.pdfizzai.vercel.app',
    'https://refdocai.vercel.app',
    'https://www.refdocai.vercel.app',
    process.env.FRONTEND_URL,
  ].filter(Boolean); // Remove undefined values

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, curl, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked request from origin: ${origin}`);
        callback(null, false); // Don't throw error, just deny
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Cookie parser
  app.use(cookieParser());

  await app.init();

  // Run database seeder only once per Lambda container lifecycle
  if (!isSeeded && process.env.SKIP_SEED !== 'true') {
    try {
      const { SeedService } = require('./dist/services/seed.service');
      const seedService = app.get(SeedService);
      await seedService.seedDatabase();
      isSeeded = true;
      console.log('Database seeding completed');
    } catch (error) {
      console.error('Failed to seed database:', error);
      // Don't fail the Lambda if seeding fails
    }
  }

  cachedApp = app.getHttpAdapter().getInstance();
  return cachedApp;
}

// Lambda handler
exports.handler = async (event, context) => {
  const app = await bootstrap();
  const handler = serverless(app, {
    binary: ['image/*', 'application/pdf'],
  });
  
  return handler(event, context);
};
