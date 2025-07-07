import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('chat_sessions')
export class ChatSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User, 'chatSessions')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ nullable: true })
  name: string;

  @Column({ default: false })
  nameWasAiGenerated: boolean;

  @CreateDateColumn()
  created_at: Date;

  @OneToMany('ChatMessage', 'session')
  messages: any[];

  @Column('text', { array: true, default: () => 'ARRAY[]::text[]' })
  contextFileIds: string[]; // IDs of files used for context in this session
}
