// Import crypto polyfill FIRST before any other modules
import './crypto-polyfill';

import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

// Entities
import { User } from './entities/user.entity';
import { Folder } from './entities/folder.entity';
import { File } from './entities/file.entity';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';

// Services
import { AuthService } from './services/auth.service';
import { FolderService } from './services/folder.service';
import { FileService } from './services/file.service';
import { ChatService } from './services/chat.service';
import { AIService } from './services/ai.service';
import { SeedService } from './services/seed.service';

// Controllers
import { AuthController } from './controllers/auth.controller';
import { FolderController } from './controllers/folder.controller';
import { FileController } from './controllers/files.controller';
import { ChatController } from './controllers/chat.controller';
import { WebhooksController } from './controllers/webhooks.controller';
import { SeedController } from './controllers/seed.controller';

// Strategies
import { JwtStrategy } from './strategies/jwt.strategy';

// Middleware
import { LoggingMiddleware } from './middleware/logging.middleware';
import { WebhooksService } from './services/webhooks.service';

// Interceptors
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { Subscription } from './entities/subscription.entity';
import { Transaction } from './entities/transaction.entity';
import { PaymentService } from './services/payment.service';
import { PaymentController } from './controllers/payment.controller';
import { SubscriptionUsage } from './entities/subscription-usage.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { ExtractedContent } from './entities/extracted-content.entity';
import { RawExtractedContent } from './entities/raw-extracted-contents';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD', 'password'),
        database: configService.get('DB_NAME', 'refery_ai'),
        entities: [User, Folder, File, ChatSession, ChatMessage, Subscription, Transaction, SubscriptionUsage, SubscriptionPlan, ExtractedContent, RawExtractedContent],
        synchronize: true,
        dropSchema: true,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User, Folder, File, ChatSession, ChatMessage, Subscription, Transaction, SubscriptionUsage, SubscriptionPlan, ExtractedContent, RawExtractedContent]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET', 'default-secret'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AuthController,
    FolderController,
    FileController,
    ChatController,
    WebhooksController,
    PaymentController,
    SeedController,
  ],
  providers: [
    AuthService,
    FolderService,
    FileService,
    ChatService,
    JwtStrategy,
    AIService,
    WebhooksService,
    PaymentService,
    SeedService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggingMiddleware)
      .forRoutes('*'); // Apply logging to all routes first
  }
}
