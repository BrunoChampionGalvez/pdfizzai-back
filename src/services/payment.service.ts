import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Subscription } from "src/entities/subscription.entity";
import { Transaction, TransactionStatus } from "src/entities/transaction.entity";
import { Repository } from "typeorm";
import axios from "axios";

@Injectable()
export class PaymentService {
    constructor(
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Transaction)
        private readonly transactionRepository: Repository<Transaction>,
    ) {}

    async subscriptionCreated(payload: any): Promise<string> {
        const newSubscription = this.subscriptionRepository.create({
            paddleSubscriptionId: payload.data.id,
            status: payload.data.status,
            createdAt: new Date(payload.data.created_at),
            nextBillingAt: payload.data.next_billing_at,
            startsAt: payload.data.current_billing_period.starts_at,
            endsAt: payload.data.current_billing_period.ends_at,
            interval: payload.data.billing_cycle.interval,
            frequency: payload.data.billing_cycle.frequency,
            paddleTransactionsIds: JSON.stringify([]), // Initialize as empty array
        })

        await this.subscriptionRepository.save(newSubscription);

        const transaction = await this.transactionRepository.findOne({
            where: {
                paddleTransactionId: payload.data.transaction_id
            }
        })

        if (transaction) {
            // Update the subscription with the transaction ID
            const transactionIds = JSON.parse(newSubscription.paddleTransactionsIds || '[]');
            transactionIds.push(payload.data.transaction_id);
            newSubscription.paddleTransactionsIds = JSON.stringify(transactionIds);
            newSubscription.hasAccess = true;

            await this.subscriptionRepository.save(newSubscription);
            
            // Update the transaction to link it to the subscription
            transaction.subscription = newSubscription;
            await this.transactionRepository.save(transaction);
        } else {
            const transactionIds = JSON.parse(newSubscription.paddleTransactionsIds || '[]');
            transactionIds.push(payload.data.transaction_id);
            newSubscription.paddleTransactionsIds = JSON.stringify(transactionIds);
            await this.subscriptionRepository.save(newSubscription);
        }

        return 'Subscription created';
    }

    async transactionCompleted(payload: any): Promise<string> {
        const newSubscription = await this.subscriptionRepository.findOne({
            where: {
                paddleSubscriptionId: payload.data.subscription_id
            }
        });
        const newTransaction = this.transactionRepository.create({
            paddleTransactionId: payload.data.id,
            amount: payload.data.payments.find(p => p.status === 'captured').amount,
            currency: payload.data.currency_code,
            paddleCustomerId: payload.data.customer_id,
            status: payload.data.payments.some(p => p.status === 'captured').status === 'captured' ? TransactionStatus.CAPTURED : TransactionStatus.ERROR,
            createdAt: new Date(payload.data.created_at),
            subscription: newSubscription || undefined,
            paddleSubscriptionId: payload.data.subscription_id,
        })

        await this.transactionRepository.save(newTransaction);

        if (newSubscription) {
            const hasAccess = payload.data.payments.some(p => p.status === 'captured');
            newSubscription.hasAccess = hasAccess;
            await this.subscriptionRepository.save(newSubscription);
        }

        return 'Transaction completed';
    }

    async subscriptionUpdated(payload: any): Promise<string> {
        const subscription = await this.subscriptionRepository.findOne({
            where: {
                paddleSubscriptionId: payload.data.id
            }
        });

        if (!subscription) {
            return 'Subscription not found';
        }

        if (payload.data.scheduled_change?.action === 'cancel') {
            subscription.hasAccess = false;
            await this.subscriptionRepository.save(subscription);
            return 'Subscription updated';
        } else {
            return 'Subscription update not handled';
        }
    }

    async subscriptionCanceled(payload: any): Promise<string> {
        const subscription = await this.subscriptionRepository.findOne({
            where: {
                paddleSubscriptionId: payload.data.id
            }
        });

        if (!subscription) {
            return 'Subscription not found';
        }

        subscription.status = 'canceled';

        await this.subscriptionRepository.save(subscription);

        return 'Subscription canceled';
    }

    async cancelSubscription(subscriptionId: string): Promise<boolean> {
        const response = await axios.post(`https://api.paddle.com/subscriptions/${subscriptionId}/cancel`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`
            }
        });

        const subscription = await this.subscriptionRepository.findOne({
            where: {
                paddleSubscriptionId: subscriptionId
            }
        });

        if (subscription) {
            subscription.status = 'canceled';
            subscription.hasAccess = false;
            await this.subscriptionRepository.save(subscription);
        }

        return true;
    }
}