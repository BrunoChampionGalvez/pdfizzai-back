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

    @Column()
    filesLimit: number; // Limit on the number of files allowed

    @Column()
    trialFilesLimit: number; // Limit on the number of trial files

    @OneToMany(() => Subscription, subscription => subscription.plan, { nullable: true })
    subscriptions: Subscription[];

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}