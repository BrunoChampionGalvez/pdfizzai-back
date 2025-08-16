import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Transaction } from "./transaction.entity";
import { User } from "./user.entity";
import { SubscriptionUsage } from "./subscription-usage.entity";
import { SubscriptionPlan } from "./subscription-plan.entity";

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

    @Column({ nullable: true })
    hasUpgraded: boolean;

    @Column({ nullable: true })
    hasDowngraded: boolean;

    @Column({ nullable: true })
    billingBeforeUpgrade: Date;

    @Column({ nullable: true })
    messagesLeftBeforeUpgrade: number;

    @Column({ nullable: true })
    filePagesLeftBeforeUpgrade: number;

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

    @ManyToOne(() => SubscriptionPlan, plan => plan.subscriptions, { nullable: true })
    @JoinColumn({ name: 'planId' })
    plan: SubscriptionPlan;

    @Column({ type: 'boolean', default: false })
    scheduledCancel: boolean;

    @ManyToOne(() => SubscriptionPlan, { nullable: true })
    @JoinColumn({ name: 'planBeforeDowngradeId' })
    planBeforeDowngrade?: SubscriptionPlan;

    @Column({ nullable: true })
    priceBeforeDowngrade?: number;

    @Column({ nullable: true })
    nameBeforeDowngrade?: string;

    @Column({ type: 'timestamp' })
    createdAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    updatedAt: Date;

  // Additional fields can be added as needed
}