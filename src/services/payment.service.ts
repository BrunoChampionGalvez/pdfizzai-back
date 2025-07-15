import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Subscription as dbSubscription } from "src/entities/subscription.entity";
import { Transaction, TransactionStatus } from "src/entities/transaction.entity";
import { Repository } from "typeorm";
import axios from "axios";
import { User } from "src/entities";
import { SubscriptionUsage } from "src/entities/subscription-usage.entity";
import { Paddle } from "@paddle/paddle-node-sdk";
import { ConfigService } from "@nestjs/config";
import { Environment, Subscription } from "@paddle/paddle-node-sdk";

@Injectable()
export class PaymentService {
    private paddle: Paddle;
    constructor(
        @InjectRepository(dbSubscription)
        private readonly subscriptionRepository: Repository<dbSubscription>,
        @InjectRepository(Transaction)
        private readonly transactionRepository: Repository<Transaction>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(SubscriptionUsage)
        private readonly subscriptionUsageRepository: Repository<SubscriptionUsage>,
        private configService: ConfigService
    ) {
        this.paddle = new Paddle(this.configService.get('PADDLE_API_KEY') as string, {
            environment: this.configService.get('NODE_ENV') === 'production' ? Environment.production : Environment.sandbox,
        });

    }


    async getSubscriptionById(paddleId: string): Promise<Subscription | null> {
        return await this.paddle.subscriptions.get(paddleId)
    }

    async subscriptionCreated(payload: any): Promise<string> {
        const user = await this.userRepository.findOne({
            where: { id: payload.data.custom_data.userId }
        });
        const newSubscription = this.subscriptionRepository.create({
            paddleSubscriptionId: payload.data.id,
            status: payload.data.status,
            createdAt: new Date(payload.data.created_at),
            nextBillingAt: payload.data.next_billed_at,
            price: payload.data.items.reduce((acc, item) => {
                acc += Number(item.price.unit_price.amount);
                return acc;
            }, 0),
            currency: payload.data.items[0].price.unit_price.currency_code,
            interval: payload.data.billing_cycle.interval,
            frequency: payload.data.billing_cycle.frequency,
            paddleTransactionsIds: JSON.stringify([]), // Initialize as empty array
            user: user || undefined,
            paddleProductId: payload.data.items[0].product.id,
            name: payload.data.custom_data.planName,
            hasTrialPeriod: payload.data.custom_data.isTrial || false,
            paddleCustomerId: payload.data.customer_id,
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
            newSubscription.hasFullAccess = Number(transaction.amount) > 0; // Assuming access is granted if the transaction amount is greater than 0

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
        const user = await this.userRepository.findOne({
            where: { id: payload.data.custom_data.userId }
        });
        const newSubscription = await this.subscriptionRepository.findOne({
            where: {
                paddleSubscriptionId: payload.data.subscription_id
            }
        });
        const newTransaction = this.transactionRepository.create({
            paddleTransactionId: payload.data.id,
            amount: payload.data.payments.find(p => p.status === 'captured')?.amount || 0,
            currency: payload.data.currency_code,
            paddleCustomerId: payload.data.customer_id,
            status: payload.data.payments.some(p => p.status === 'captured') ? TransactionStatus.CAPTURED : TransactionStatus.ERROR,
            createdAt: new Date(payload.data.created_at),
            subscription: newSubscription || undefined,
            paddleSubscriptionId: payload.data.subscription_id,
            user: user || undefined,
        })

        await this.transactionRepository.save(newTransaction);

        if (newSubscription && Number(newTransaction.amount) > 0 && !payload.data.isTrial) {
            const hasFullAccess = true
            newSubscription.hasFullAccess = hasFullAccess;

            const subscriptionUsage = this.subscriptionUsageRepository.create({
                subscription: newSubscription,
                startsAt: new Date(payload.data.billing_period.starts_at),
                endsAt: new Date(payload.data.billing_period.ends_at),
                messagesUsed: 0, // Initialize messages used to 0
            });

            await this.subscriptionUsageRepository.save(subscriptionUsage);
            await this.subscriptionRepository.save(newSubscription);
        } else if (newSubscription && payload.data.isTrial) {
            newSubscription.hasFullAccess = false;
            newSubscription.hasTrialPeriod = true;
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
            subscription.hasFullAccess = false;
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

    async cancelSubscription(paddleId: string): Promise<boolean> {
        await this.paddle.subscriptions.cancel(paddleId);

        const subscription = await this.subscriptionRepository.findOne({
            where: {
                paddleSubscriptionId: paddleId
            }
        });

        if (subscription) {
            subscription.status = 'canceled';
            subscription.hasFullAccess = false;
            await this.subscriptionRepository.save(subscription);
        }

        return true;
    }
}