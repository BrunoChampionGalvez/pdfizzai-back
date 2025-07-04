import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('folders')
export class Folder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  parent_id: string;

  @ManyToOne('Folder', 'children', { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Folder;

  @OneToMany('Folder', 'parent')
  children: Folder[];

  @Column()
  owner_id: string;

  @ManyToOne(() => User, 'folders')
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @CreateDateColumn()
  created_at: Date;

  @OneToMany('File', 'folder')
  files: any[];
}
