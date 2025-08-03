import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Subscription as dbSubscription } from "src/entities/subscription.entity";
import { Transaction, TransactionStatus } from "src/entities/transaction.entity";
import { LessThan, MoreThan, Repository, EntityManager } from "typeorm";
import axios from "axios";
import { User } from "src/entities";
import { SubscriptionUsage } from "src/entities/subscription-usage.entity";
import { AuthToken, Paddle } from "@paddle/paddle-node-sdk";
import { ConfigService } from "@nestjs/config";
import { Environment, Subscription } from "@paddle/paddle-node-sdk";
import { SubscriptionPlan } from "src/entities/subscription-plan.entity";
import { Cron } from "@nestjs/schedule";

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

        user.paddleCustomerId = payload.data.customer_id;
        await this.userRepository.save(user);

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
                filePagesUploaded: 0, // Initialize file pages uploaded to 0
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
            subscription.hasDowngraded = false; // Reset downgrade status on cancellation
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

    async increaseMessageUsage(subscriptionUsageId: string | undefined, entityManager?: EntityManager): Promise<void> {
        console.log('🔧 PaymentService: increaseMessageUsage called with:', {
            subscriptionUsageId,
            hasEntityManager: !!entityManager
        });
        
        if (!subscriptionUsageId) {
            console.log('🔧 PaymentService: No subscriptionUsageId provided, returning early');
            return;
        }

        let subscriptionUsage: SubscriptionUsage | null;
        
        try {
            if (entityManager) {
                console.log('🔧 PaymentService: Using entityManager to find subscription usage');
                subscriptionUsage = await entityManager.findOne(SubscriptionUsage, {
                    where: { id: subscriptionUsageId }
                });
            } else {
                console.log('🔧 PaymentService: Using repository to find subscription usage');
                subscriptionUsage = await this.subscriptionUsageRepository.findOne({
                    where: { id: subscriptionUsageId }
                });
            }
            
            console.log('🔧 PaymentService: Found subscription usage:', {
                found: !!subscriptionUsage,
                currentMessagesUsed: subscriptionUsage?.messagesUsed,
                subscriptionUsageId: subscriptionUsage?.id
            });
        } catch (error) {
            console.error('❌ PaymentService: Error finding subscription usage:', error);
            throw error;
        }

        if (!subscriptionUsage) {
            console.error('❌ PaymentService: Subscription usage not found for ID:', subscriptionUsageId);
            throw new NotFoundException('Subscription usage not found');
        }

        const oldMessagesUsed = subscriptionUsage.messagesUsed;
        subscriptionUsage.messagesUsed += 1;
        
        console.log('🔧 PaymentService: Updating messagesUsed from', oldMessagesUsed, 'to', subscriptionUsage.messagesUsed);
        
        try {
            if (entityManager) {
                console.log('🔧 PaymentService: Saving with entityManager');
                await entityManager.save(subscriptionUsage);
                console.log('✅ PaymentService: Successfully saved with entityManager');
            } else {
                console.log('🔧 PaymentService: Saving with repository');
                await this.subscriptionUsageRepository.save(subscriptionUsage);
                console.log('✅ PaymentService: Successfully saved with repository');
            }
        } catch (error) {
            console.error('❌ PaymentService: Error saving subscription usage:', error);
            throw error;
        }
    }

    async generateAuthTokenCustomer(customerId: string): Promise<AuthToken> {
        try {
            const response = await this.paddle.customers.generateAuthToken(customerId);
            return response;
        } catch (error) {
            console.error('Error generating auth token for customer:', error);
            throw new Error('Failed to generate auth token');
        }
    }

    async upgradeSubscription(subscriptionId: string | undefined): Promise<boolean> {
        if (!subscriptionId) {
            throw new NotFoundException('Subscription ID is required for upgrade');
        }

        const subscription = await this.subscriptionRepository.findOne({
            where: { paddleSubscriptionId: subscriptionId },
            relations: ['plan']
        });

        if (!subscription) {
            throw new NotFoundException('Subscription not found');
        }

        const proPlan = await this.subscriptionPlanRepository.findOne({
            where: { name: 'pro' }
        });

        if (!proPlan) {
            throw new NotFoundException('Pro plan not found');
        }

        // Update scheduled change
        await this.paddle.subscriptions.update(subscriptionId, {
            scheduledChange: null, // No scheduled change
        });

        // Update proration
        await this.paddle.subscriptions.update(subscriptionId, {
            prorationBillingMode: 'full_immediately', // Ensure immediate proration
            items: [
                {
                    priceId: subscription?.interval === 'month' ? proPlan.monthlyPaddlePriceId : proPlan.yearlyPaddlePriceId,
                    quantity: 1,
                }
            ],
        });

        // Update billing date
        await this.paddle.subscriptions.update(subscriptionId, {
            nextBilledAt: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString(), // Set next billing date to one month later
            prorationBillingMode: 'do_not_bill', // Ensure no proration
        });

        subscription.paddleProductId = proPlan?.paddleProductId || 'Error: Pro plan not found';
        subscription.plan = proPlan;
        subscription.scheduledCancel = false; // Reset scheduled cancel if upgrading
        subscription.hasFullAccess = true; // Assume upgrade grants full access

        subscription.billingBeforeUpgrade = subscription.nextBillingAt; // Store the billing date before upgrade
        subscription.nextBillingAt = new Date(new Date().setMonth(new Date().getMonth() + 1)); // Set next billing date to one month later
        subscription.hasUpgraded = true; // Mark as upgraded

        const subscriptionUsage = await this.subscriptionUsageRepository.findOne({
            where: { subscription: { id: subscription.id } }
        });
        const starterPlan = await this.subscriptionPlanRepository.findOne({
            where: { name: 'starter' }
        });
        if (!subscriptionUsage || !starterPlan) {
            throw new NotFoundException('Subscription usage or starter plan not found');
        }
        const messagesLeftBeforeUpgrade = subscriptionUsage ? starterPlan?.messagesLimit - subscriptionUsage.messagesUsed : 0;
        const filePagesLeftBeforeUpgrade = subscriptionUsage ? starterPlan?.filePagesLimit - subscriptionUsage.filePagesUploaded : 0;
        subscription.messagesLeftBeforeUpgrade = messagesLeftBeforeUpgrade;
        subscription.filePagesLeftBeforeUpgrade = filePagesLeftBeforeUpgrade;
        subscription.price = proPlan.price;
        subscription.name = proPlan.name;
        await this.subscriptionRepository.save(subscription);

        return true;
    }

    async downgradeSubscription(subscriptionId: string | undefined): Promise<boolean> {
        if (!subscriptionId) {
            throw new NotFoundException('Subscription ID is required for downgrade');
        }

        const subscription = await this.subscriptionRepository.findOne({
            where: { paddleSubscriptionId: subscriptionId },
            relations: ['plan']
        });

        if (!subscription) {
            throw new NotFoundException('Subscription not found');
        }

        const starterPlan = await this.subscriptionPlanRepository.findOne({
            where: { name: 'starter' }
        });

        if (!starterPlan) {
            throw new NotFoundException('Starter plan not found');
        }

        // Update scheduled change
        await this.paddle.subscriptions.update(subscriptionId, {
            scheduledChange: null, // No scheduled change
        });

        // Update proration
        await this.paddle.subscriptions.update(subscriptionId, {
            items: [
                {
                    priceId: subscription?.interval === 'month' ? starterPlan.monthlyPaddlePriceId : starterPlan.yearlyPaddlePriceId,
                    quantity: 1,
                },
            ], // Replace with actual new plan ID
            prorationBillingMode: 'do_not_bill', // Ensure no proration
        });

        subscription.hasDowngraded = true; // Mark as downgraded
        subscription.paddleProductId = starterPlan?.paddleProductId || 'Error: Starter plan not found';
        subscription.scheduledCancel = false; // Reset scheduled cancel if downgrading
        subscription.hasFullAccess = true; // Assume downgrade still grants full access
        await this.subscriptionRepository.save(subscription);

        return true;
    }

    async reactivateSubscription(subscriptionId: string): Promise<boolean> {
        if (!subscriptionId) {
            throw new NotFoundException('Subscription ID is required for reactivation');
        }

        const subscription = await this.subscriptionRepository.findOne({
            where: { paddleSubscriptionId: subscriptionId },
            relations: ['plan']
        });

        if (!subscription) {
            throw new NotFoundException('Subscription not found');
        }

        // Reactivate the subscription
        await this.paddle.subscriptions.update(subscriptionId, {
            scheduledChange: null, // No scheduled change
        });

        subscription.status = 'active';
        subscription.scheduledCancel = false; // Reset scheduled cancel if reactivating
        subscription.hasFullAccess = true; // Assume reactivation grants full access

        await this.subscriptionRepository.save(subscription);

        return true;
    }

    @Cron('0 0 * * *') // Runs daily at midnight
    async resetUpgradedSubscriptions(): Promise<void> {
        const subscriptions = await this.subscriptionRepository.find({
            where: { hasUpgraded: true, scheduledCancel: false },
            relations: ['plan']
        });

        for (const subscription of subscriptions) {
            if (subscription.billingBeforeUpgrade && new Date(subscription.billingBeforeUpgrade) >= new Date()) {
                // If the next billing date is today or in the past, reset the upgrade status
                subscription.hasUpgraded = false;
                subscription.messagesLeftBeforeUpgrade = 0; // Reset messages left before upgrade
                subscription.filePagesLeftBeforeUpgrade = 0; // Reset file pages left before upgrade
                await this.subscriptionRepository.save(subscription);
            }
        }
    }

    @Cron('0 0 * * *') // Runs daily at midnight
    async updateDowngradeSubscriptions(): Promise<void> {
        const subscriptions = await this.subscriptionRepository.find({
            where: { hasDowngraded: true, scheduledCancel: false, nextBillingAt: LessThan(new Date()) },
            relations: ['plan']
        });

        for (const subscription of subscriptions) {
            // Downgrade to starter plan
            const starterPlan = await this.subscriptionPlanRepository.findOne({
                where: { name: 'starter' }
            });

            if (!starterPlan) {
                throw new NotFoundException('Starter plan not found');
            }

            subscription.hasDowngraded = false; // Reset downgrade status
            subscription.plan = starterPlan;
            await this.subscriptionRepository.save(subscription);
        }
    }

    async cancelDowngrade(subscriptionId: string): Promise<boolean> {
        if (!subscriptionId) {
            throw new NotFoundException('Subscription ID is required for canceling downgrade');
        }

        const subscription = await this.subscriptionRepository.findOne({
            where: { paddleSubscriptionId: subscriptionId },
            relations: ['plan']
        });

        if (!subscription) {
            throw new NotFoundException('Subscription not found');
        }

        // Cancel the downgrade
        subscription.hasDowngraded = false; // Reset downgrade status
        subscription.scheduledCancel = false; // Reset scheduled cancel if canceling downgrade
        await this.subscriptionRepository.save(subscription);

        return true;
    }
}