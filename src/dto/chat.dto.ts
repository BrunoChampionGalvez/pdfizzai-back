import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateChatSessionDto {
  @IsOptional()
  @IsString()
  sessionName?: string;
}

export class SendMessageDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fileIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  folderIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  previousSessionsIds?: string[];
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
