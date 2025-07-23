import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Subscription } from "./subscription.entity";

@Entity('subscription_plans')
export class SubscriptionPlan {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column()
    price: number;

    @Column()
    currency: string;

    @Column()
    interval: string; // e.g., 'monthly', 'yearly'

    @Column()
    frequency: number; // e.g., 1 for monthly, 12 for yearly

    @Column()
    messagesLimit: number; // Limit on the number of messages allowed

    @Column()
    trialMessagesLimit: number; // Limit on the number of trial messages

    @Column({ type: 'int', nullable: true })
    filePagesLimit: number; // Limit on the number of file pages allowed

    @Column({ type: 'int', nullable: true })
    trialFilePagesLimit: number; // Limit on the number of trial file pages

    @OneToMany(() => Subscription, subscription => subscription.plan, { nullable: true })
    subscriptions: Subscription[];

    @Column({ nullable: true })
    monthlyPaddlePriceId: string; // Paddle price ID for monthly billing

    @Column({ nullable: true })
    yearlyPaddlePriceId: string; // Paddle price ID for yearly billing

    @Column({ nullable: true })
    paddleProductId: string; // Paddle product ID

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}