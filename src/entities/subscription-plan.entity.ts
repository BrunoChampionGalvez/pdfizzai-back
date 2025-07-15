import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

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

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}