import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatMessage, MessageRole } from '../entities/chat-message.entity';
import { CreateChatSessionDto, SendMessageDto, ChatResponseDto, ChatReference } from '../dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private chatSessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private chatMessageRepository: Repository<ChatMessage>,
  ) {}

  async createChatSession(userId: string, createChatSessionDto: CreateChatSessionDto): Promise<ChatSession> {
    const session = this.chatSessionRepository.create({
      user_id: userId,
    });

    return this.chatSessionRepository.save(session);
  }

  async sendMessage(userId: string, sessionId: string, sendMessageDto: SendMessageDto): Promise<ChatResponseDto> {
    const { message } = sendMessageDto;

    // Verify session belongs to user
    const session = await this.chatSessionRepository.findOne({
      where: { id: sessionId, user_id: userId },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    // Save user message
    const userMessage = this.chatMessageRepository.create({
      session_id: sessionId,
      role: MessageRole.USER,
      content: message,
    });
    await this.chatMessageRepository.save(userMessage);

    // Mock AI response for now
    const aiResponse = await this.generateAIResponse(message);

    // Save AI response
    const assistantMessage = this.chatMessageRepository.create({
      session_id: sessionId,
      role: MessageRole.ASSISTANT,
      content: aiResponse.reply,
    });
    await this.chatMessageRepository.save(assistantMessage);

    return aiResponse;
  }

  async getChatHistory(userId: string, sessionId: string): Promise<ChatMessage[]> {
    // Verify session belongs to user
    const session = await this.chatSessionRepository.findOne({
      where: { id: sessionId, user_id: userId },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    return this.chatMessageRepository.find({
      where: { session_id: sessionId },
      order: { timestamp: 'ASC' },
      relations: ['referencedFile'],
    });
  }

  async getUserChatSessions(userId: string): Promise<ChatSession[]> {
    return this.chatSessionRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  private async generateAIResponse(message: string): Promise<ChatResponseDto> {
    // This is a mock implementation
    // In a real application, you would call your AI service here
    
    const mockReferences: ChatReference[] = [
      {
        fileId: 'sample-file-id',
        page: 1,
        text: 'This is a sample reference from your document that relates to your question.',
      },
    ];

    return {
      reply: `I understand you're asking about: "${message}". Based on your uploaded documents, here's what I found. This is a mock response that will be replaced with actual AI integration.`,
      references: mockReferences,
    };
  }
}
