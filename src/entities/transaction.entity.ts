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

    @Column()
    paddleTransactionId: string;

    @Column()
    paddleSubscriptionId: string;

    @Column()
    amount: string;

    @Column()
    currency: string;

    @Column()
    paddleCustomerId: string;

    @Column({ type: 'enum', enum: TransactionStatus })
    status: TransactionStatus.CAPTURED | TransactionStatus.ERROR;

    @ManyToOne(() => User, user => user.transactions)
    @JoinColumn({ name: 'userId' })
    user: User;

    @ManyToOne(() => Subscription, subscription => subscription.transactions)
    @JoinColumn({ name: 'subscriptionId' })
    subscription: Subscription;

    @Column({ type: 'timestamp' })
    createdAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    updatedAt: Date;
}