import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password_hash: string;

  @CreateDateColumn()
  created_at: Date;

  @OneToMany('Folder', 'owner')
  folders: any[];

  @OneToMany('File', 'owner')
  files: any[];

  @OneToMany('ChatSession', 'user')
  chatSessions: any[];
}
