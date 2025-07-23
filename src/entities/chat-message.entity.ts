import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { File } from './file.entity';

export enum MessageRole {
  USER = 'user',
  MODEL = 'model'
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

  @ManyToOne('File', 'referencedMessages', { nullable: true })
  @JoinColumn({ name: 'referenced_file_id' })
  referencedFiles: File[];

  @Column({ type: 'text', nullable: true })
  context: string; // Optional context for the message, e.g. search query or reference

  @Column({ type: 'jsonb', nullable: true })
  citations: FileCitation[];

  @Column({ type: 'jsonb', nullable: true })
  selectedMaterials: MentionedMaterial[]; // Materials attached to the message

  @CreateDateColumn()
  created_at: Date;
}
