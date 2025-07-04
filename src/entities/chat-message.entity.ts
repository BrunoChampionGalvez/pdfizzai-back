import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant'
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

  @Column({ nullable: true })
  referenced_file_id: string;

  @ManyToOne('File', 'referencedMessages', { nullable: true })
  @JoinColumn({ name: 'referenced_file_id' })
  referencedFile: any;

  @Column({ nullable: true })
  referenced_page: number;

  @Column('text', { nullable: true })
  referenced_text_snippet: string;

  @CreateDateColumn()
  timestamp: Date;
}
