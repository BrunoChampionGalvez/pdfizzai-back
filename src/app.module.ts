import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
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
import { IPWhitelistService } from './services/ip-whitelist.service';

// Controllers
import { AuthController } from './controllers/auth.controller';
import { FolderController } from './controllers/folder.controller';
import { FileController } from './controllers/files.controller';
import { ChatController } from './controllers/chat.controller';
import { WebhooksController } from './controllers/webhooks.controller';

// Strategies
import { JwtStrategy } from './strategies/jwt.strategy';

// Guards
import { JwtAuthGuard } from './guards/jwt-auth.guard';

// Middleware
import { IPWhitelistMiddleware } from './middleware/ip-whitelist.middleware';
import { WebhooksService } from './services/webhooks.service';
import { Subscription } from './entities/subscription.entity';
import { Transaction } from './entities/transaction.entity';
import { PaymentService } from './services/payment.service';
import { PaymentController } from './controllers/payment.controller';

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
        entities: [User, Folder, File, ChatSession, ChatMessage, Subscription, Transaction],
        synchronize: configService.get('NODE_ENV') !== 'production',
        dropSchema: false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User, Folder, File, ChatSession, ChatMessage, Subscription, Transaction]),
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
  ],
  controllers: [
    AuthController,
    FolderController,
    FileController,
    ChatController,
    WebhooksController,
    PaymentController,
  ],
  providers: [
    AuthService,
    FolderService,
    FileService,
    ChatService,
    JwtStrategy,
    AIService,
    IPWhitelistService,
    WebhooksService,
    PaymentService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(IPWhitelistMiddleware)
      .forRoutes('*'); // Apply to all routes
  }
}
