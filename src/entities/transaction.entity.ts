import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Subscription } from "./subscription.entity";
import { User } from "./user.entity";

export enum TransactionStatus {
    CAPTURED = 'captured',
    ERROR ='error',
}

@Entity('transactions')
export class Transaction {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ nullable: true })
    paddleTransactionId: string;

    @Column({ nullable: true })
    paddleSubscriptionId: string;

    @Column({ nullable: true })
    amount: number;

    @Column({ nullable: true })
    currency: string;

    @Column({ nullable: true })
    paddleCustomerId: string;

    @Column({ type: 'enum', enum: TransactionStatus, nullable: true })
    status: TransactionStatus.CAPTURED | TransactionStatus.ERROR;

    @ManyToOne(() => User, user => user.transactions, { nullable: true })
    @JoinColumn({ name: 'userId' })
    user: User;

    @ManyToOne(() => Subscription, subscription => subscription.transactions, { nullable: true })
    @JoinColumn({ name: 'subscriptionId' })
    subscription: Subscription;

    @Column({ type: 'timestamp' })
    createdAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    updatedAt: Date;
}