import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Transaction } from "./transaction.entity";
import { User } from "./user.entity";

export type SubscriptionPrice = {
  amount: number;
  currency: string;
};

@Entity('subscriptions')
export class Subscription {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    paddleSubscriptionId: string;

    @Column({ type: 'jsonb' })
    paddleTransactionsIds: string;

    @Column()
    name: string;

    @Column()
    type: string;
    
    @Column()
    status: string;

    @Column()
    productId: string;

    @Column('jsonb')
    price: SubscriptionPrice;

    @Column()
    interval: string;

    @Column()
    frequency: number;

    @Column()
    nextBillingAt: Date;

    @ManyToOne(() => User, user => user.subscriptions)
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    startsAt: Date;

    @Column({ nullable: true })
    endsAt: Date;

    @OneToMany(() => Transaction, transaction => transaction.subscription)
    transactions: Transaction[];

    @Column()
    paddleCustomerId: string;

    @Column()
    hasAccess: boolean;

    @Column({ type: 'timestamp' })
    createdAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    updatedAt: Date;


  // Additional fields can be added as needed
}