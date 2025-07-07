import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { File } from './file.entity';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant'
}

export interface FileCitation {
  id: string;
  text: string;
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

  @ManyToOne('File', 'referencedMessages', { nullable: true })
  @JoinColumn({ name: 'referenced_file_id' })
  referencedFiles: File[];

  @Column({ type: 'text', nullable: true })
  context: string; // Optional context for the message, e.g. search query or reference

  @Column({ type: 'jsonb', nullable: true })
  citations: FileCitation[];

  @CreateDateColumn()
  created_at: Date;
}
