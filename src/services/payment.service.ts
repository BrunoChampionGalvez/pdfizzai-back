import { Injectable, NotFoundException } from "@nestjs/common";
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
import { SubscriptionPlan } from "src/entities/subscription-plan.entity";

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
        @InjectRepository(SubscriptionPlan)
        private readonly subscriptionPlanRepository: Repository<SubscriptionPlan>,
        private configService: ConfigService
    ) {
        this.paddle = new Paddle(this.configService.get('PADDLE_API_KEY') as string, {
            environment: this.configService.get('NODE_ENV') === 'production' ? Environment.production : Environment.sandbox,
        });

    }

    async getPaddleSubscriptionById(paddleId: string): Promise<Subscription | null> {
        return await this.paddle.subscriptions.get(paddleId)
    }

    async getDbSubscriptionById(subscriptionId: string): Promise< dbSubscription | null> {
        return await this.subscriptionRepository.findOne({
            where: {
                id: subscriptionId
            },
        });
    }

    async getSubscriptionUsageById(subscriptionId: string): Promise<SubscriptionUsage | null> {
        return await this.subscriptionUsageRepository.findOne({
            where: {
                subscription: { id: subscriptionId }
            },
        });
    }

    async getUserSubscription(userId: string): Promise<dbSubscription | null> {
        return await this.subscriptionRepository.findOne({
            where: {
                user: { id: userId }
            },
            relations: ['plan', 'user'],
            order: { createdAt: 'DESC' } // Get the most recent subscription
        });
    }

    async getUserSubscriptionUsage(userId: string): Promise<SubscriptionUsage | null> {
        return await this.subscriptionUsageRepository.findOne({
            where: {
                subscription: { user: { id: userId } }
            },
            relations: ['subscription'],
            order: { createdAt: 'DESC' } // Get the most recent usage record
        });
    }

    async getUserFilesCount(userId: string): Promise<{ totalFiles: number }> {
        // We need to inject the File repository for this
        // For now, let's use the entity manager to query
        const result = await this.subscriptionRepository.manager.query(
            'SELECT COUNT(*) as total_files FROM files WHERE owner_id = $1',
            [userId]
        );
        
        return { totalFiles: parseInt(result[0]?.total_files || '0', 10) };
    }

    async getSubscriptionPlanById(subscriptionId: string): Promise<any> {
        const subscription = await this.subscriptionPlanRepository.findOne({
            where: {
                subscriptions: {
                    id: subscriptionId 
                }
            },
        });

        if (!subscription) {
            return null;
        }

        return subscription;
    }

    async subscriptionCreated(payload: any): Promise<string> {
        const user = await this.userRepository.findOne({
            where: { id: payload.data.custom_data.userId }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        const subscriptionPlan = await this.subscriptionPlanRepository.findOne({
            where: { name: payload.data.custom_data.planName }
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
            plan: subscriptionPlan || undefined,
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
                filesUploaded: 0, // Initialize files uploaded to 0
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
        subscription.hasFullAccess = false;

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
            subscription.scheduledCancel = true;
            await this.subscriptionRepository.save(subscription);
        }

        return true;
    }

    async getSubscriptionUsageByUser(userId: string): Promise<SubscriptionUsage | null> {
        return await this.subscriptionUsageRepository.findOne({
            where: {
                subscription: { user: { id: userId } }
            },
            relations: ['subscription'],
            order: { createdAt: 'DESC' } // Get the most recent usage record
        });
    }

    async increaseMessageUsage(subscriptionUsageId: string | undefined): Promise<void> {
        if (!subscriptionUsageId) return;

        const subscriptionUsage = await this.subscriptionUsageRepository.findOne({
            where: { id: subscriptionUsageId }
        });

        if (!subscriptionUsage) {
            throw new NotFoundException('Subscription usage not found');
        }

        subscriptionUsage.messagesUsed += 1;
        await this.subscriptionUsageRepository.save(subscriptionUsage);
    }
}