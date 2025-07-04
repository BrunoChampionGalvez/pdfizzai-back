import { Controller, Post, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { ChatService } from '../services/chat.service';
import { CreateChatSessionDto, SendMessageDto } from '../dto/chat.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('api/chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('start')
  async startChatSession(
    @Req() req: Request & { user: any },
    @Body() createChatSessionDto: CreateChatSessionDto,
  ) {
    return this.chatService.createChatSession(req.user.userId, createChatSessionDto);
  }

  @Post(':sessionId/message')
  async sendMessage(
    @Req() req: Request & { user: any },
    @Param('sessionId') sessionId: string,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(req.user.userId, sessionId, sendMessageDto);
  }

  @Get(':sessionId/history')
  async getChatHistory(
    @Req() req: Request & { user: any },
    @Param('sessionId') sessionId: string,
  ) {
    return this.chatService.getChatHistory(req.user.userId, sessionId);
  }

  @Get('sessions')
  async getUserChatSessions(@Req() req: Request & { user: any }) {
    return this.chatService.getUserChatSessions(req.user.userId);
  }
}
