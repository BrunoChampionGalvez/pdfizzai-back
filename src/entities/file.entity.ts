import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { Folder } from './folder.entity';

@Entity('files')
export class File {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  filename: string;

  @Column()
  mime_type: string;

  @Column()
  size_bytes: number;

  @Column({ nullable: true })
  folder_id: string;

  @ManyToOne(() => Folder, 'files', { nullable: true })
  @JoinColumn({ name: 'folder_id' })
  folder: Folder;

  @Column()
  owner_id: string;

  @ManyToOne(() => User, 'files')
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @CreateDateColumn()
  upload_date: Date;

  @Column()
  storage_path: string;

  @OneToMany('ChatMessage', 'referencedFile')
  referencedMessages: any[];
}
