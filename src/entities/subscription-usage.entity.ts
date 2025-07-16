import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subscription } from "./subscription.entity";

@Entity('subscription_usages')
export class SubscriptionUsage {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Subscription, subscription => subscription.usages, { nullable: false })
    subscription: Subscription;

    @Column({ type: 'timestamp' })
    startsAt: Date;

    @Column({ type: 'timestamp' })
    endsAt: Date;

    @Column({ type: 'int', default: 0 })
    messagesUsed: number;

    @Column({ type: 'int', default: 0 })
    filesUploaded: number;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;
}