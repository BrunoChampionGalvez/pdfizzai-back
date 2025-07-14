import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { Subscription } from './subscription.entity';
import { Transaction } from './transaction.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password_hash: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  paddleCustomerId: string;

  @Column()
  country: string;

  @CreateDateColumn()
  created_at: Date;

  @OneToMany('Folder', 'owner')
  folders: any[];

  @OneToMany('File', 'owner')
  files: any[];

  @OneToMany('ChatSession', 'user')
  chatSessions: any[];

  @OneToMany(() => Subscription, subscription => subscription.user)
  subscriptions: Subscription[];

  @OneToMany(() => Transaction, transaction => transaction.user)
  transactions: Transaction[];
}
