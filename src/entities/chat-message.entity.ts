import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, ManyToMany, OneToMany, JoinTable, OneToOne } from 'typeorm';
import { File } from './file.entity';
import { interval } from 'rxjs';
import { ExtractedContent } from './extracted-content.entity';
import { RawExtractedContent } from './raw-extracted-contents';

export enum MessageRole {
  USER = 'user',
  MODEL = 'model',
  DEVELOPER = 'developer',
  ASSISTANT = 'assistant',
}

export interface FileCitation {
  id: string;
  text: string;
}

export interface MentionedMaterial {
  id: string;
  displayName: string;
  type: 'file' | 'folder';
  originalName: string;
}

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  session_id: string;

  @ManyToOne('ChatSession', 'messages')
  @JoinColumn({ name: 'session_id' })
  session: any;

  @Column({
    type: 'enum',
    enum: MessageRole
  })
  role: MessageRole;

  @Column('text')
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  questions: string[]; // Questions generated from the user query

  @ManyToMany(() => File, (file) => file.referencedMessages, { nullable: true })
  referencedFiles: File[];

  @Column({ type: 'jsonb', nullable: true })
  conversationSummary: string; // Summary of the conversation if applicable

  @ManyToMany(() => ExtractedContent, (extractedContent) => extractedContent.chatMessages, { nullable: true, cascade: true })
  @JoinTable({
    name: 'chat_messages_extracted_contents',
    joinColumn: { name: 'chatMessageId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'extractedContentId', referencedColumnName: 'id' },
  })
  extractedContents: ExtractedContent[];

  @OneToMany(() => RawExtractedContent, (rawExtractedContent) => rawExtractedContent.chatMessage)
  rawExtractedContents: RawExtractedContent[];

  @Column({ type: 'jsonb', nullable: true })
  citations: FileCitation[];

  @Column({ type: 'jsonb', nullable: true })
  selectedMaterials: MentionedMaterial[]; // Materials attached to the message

  @CreateDateColumn()
  created_at: Date;
}
