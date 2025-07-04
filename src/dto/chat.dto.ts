import { IsString, IsOptional } from 'class-validator';

export class CreateChatSessionDto {
  @IsOptional()
  @IsString()
  sessionName?: string;
}

export class SendMessageDto {
  @IsString()
  message: string;
}

export class ChatReference {
  fileId: string;
  page: number;
  text: string;
}

export class ChatResponseDto {
  reply: string;
  references: ChatReference[];
}
