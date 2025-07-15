import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Transaction } from "./transaction.entity";
import { User } from "./user.entity";
import { SubscriptionUsage } from "./subscription-usage.entity";

@Entity('subscriptions')
export class Subscription {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ nullable: true })
    paddleSubscriptionId: string;

    @Column({ type: 'jsonb', nullable: true })
    paddleTransactionsIds: string;

    @Column({ nullable: true })
    name: string;

    @Column({ nullable: true })
    type: string;
    
    @Column({ nullable: true })
    status: string;

    @Column({ nullable: true })
    paddleProductId: string;

    @Column({ nullable: true })
    price: number;

    @Column({ nullable: true })
    currency: string;

    @Column({ nullable: true })
    interval: string;

    @Column({ nullable: true })
    frequency: number;

    @Column({ nullable: true })
    nextBillingAt: Date;

    @ManyToOne(() => User, user => user.subscriptions, { nullable: true })
    @JoinColumn({ name: 'userId' })
    user: User;

    @OneToMany(() => Transaction, transaction => transaction.subscription, { nullable: true })
    transactions: Transaction[];

    @Column({ nullable: true })
    paddleCustomerId: string;

    @Column({ type: 'boolean', default: false })
    hasFullAccess: boolean;

    @Column({ type: 'boolean', default: false })
    hasTrialPeriod: boolean;

    @OneToMany(() => SubscriptionUsage, usage => usage.subscription, { nullable: true })
    usages: SubscriptionUsage[];

    @Column({ type: 'timestamp' })
    createdAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    updatedAt: Date;

  // Additional fields can be added as needed
}