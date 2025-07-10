import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';
import { Folder } from './folder.entity';
import { ChatMessage } from './chat-message.entity';

@Entity('files')
export class File {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({nullable: true})
  filename: string;

  @Column({ type: 'text', nullable: true })
  textByPages: string;

  @Column({ type: 'boolean', default: false })
  textExtracted: boolean;

  @Column({ type: 'boolean', default: false })
  processed: boolean;

  @Column()
  mime_type: string;

  @Column()
  size_bytes: number;

  @Column({ nullable: true })
  folder_id: string;

  @ManyToOne(() => Folder, 'files', { nullable: true })
  @JoinColumn({ name: 'folder_id' })
  folder: Folder;

  @Column({ type: 'text', nullable: true })
  summary: string;

  @Column({ type: 'text', array: true, nullable: true })
  chunks: string[];

  @Column()
  originalName: string;

  @Column()
  owner_id: string;

  @ManyToOne(() => User, 'files')
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @CreateDateColumn()
  upload_date: Date;

  /*@Column({ type: 'text', nullable: true })
  google_storage_url: string;*/

  @Column({ type: 'text' })
  storage_path: string;

  @Column({ nullable: true })
  expires: number;

  @OneToMany('ChatMessage', 'referencedFile')
  referencedMessages: ChatMessage[];

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}
