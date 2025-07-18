import { Controller, Get, NotFoundException, Param, Patch, Put } from "@nestjs/common";
import { AuthToken, Subscription } from "@paddle/paddle-node-sdk";
import { PaymentService } from "src/services/payment.service";
import { SubscriptionUsage } from "src/entities/subscription-usage.entity";
import { Subscription as dbSubscription } from "src/entities/subscription.entity";

@Controller("api/payment")
export class PaymentController {
    constructor(
        private readonly paymentService: PaymentService
    ) {
        // Controller constructor can be used for dependency injection if needed
    }

    // Define payment-related endpoints here
    @Put('cancel-subscription/:subscriptionId')
    async cancelSubscription(
        @Param('subscriptionId') subscriptionId: string
    ): Promise<boolean> {
        // Logic to cancel a subscription
        return await this.paymentService.cancelSubscription(subscriptionId);
    }

    @Get('subscription/paddle/:subscriptionId')
    async getPaddleSubscription(
        @Param('subscriptionId') subscriptionId: string
    ): Promise<Subscription | null> {
        // Logic to get the current subscription status
        return await this.paymentService.getPaddleSubscriptionById(subscriptionId);
    }

    @Get('subscription/db/:subscriptionId')
    async getDbSubscription(
        @Param('subscriptionId') subscriptionId: string
    ): Promise<dbSubscription | null> {
        // Logic to get the current subscription status
        return await this.paymentService.getDbSubscriptionById(subscriptionId);
    }

    @Get('subscription/user/:userId')
    async getUserSubscription(
        @Param('userId') userId: string
    ): Promise<dbSubscription | null> {
        // Logic to get the user's current subscription
        const userSubscription = await this.paymentService.getUserSubscription(userId);
        return userSubscription
    }

    @Get('subscription-usage/:subscriptionId')
    async getSubscriptionUsage(
        @Param('subscriptionId') subscriptionId: string
    ): Promise<SubscriptionUsage | null> {
        // Logic to get the current subscription usage
        return await this.paymentService.getSubscriptionUsageById(subscriptionId);
    }

    @Get('subscription-usage/user/:userId')
    async getUserSubscriptionUsage(
        @Param('userId') userId: string
    ): Promise<SubscriptionUsage | null> {
        // Logic to get the user's current subscription usage
        const subscriptionUsage = await this.paymentService.getUserSubscriptionUsage(userId);

        return subscriptionUsage
    }

    @Get('files-count/user/:userId')
    async getUserFilesCount(
        @Param('userId') userId: string
    ): Promise<{ totalFiles: number }> {
        // Logic to get the user's total file count
        return await this.paymentService.getUserFilesCount(userId);
    }

    @Get('subscription-plan/:subscriptionId')
    async getSubscriptionPlan(
        @Param('subscriptionId') subscriptionId: string
    ): Promise<any> {
        // Logic to get the current subscription plan
        const subscriptionPlan = await this.paymentService.getSubscriptionPlanById(subscriptionId);
        if (!subscriptionPlan) {
            throw new NotFoundException(`Subscription plan with ID ${subscriptionId} not found`);
        }
        return subscriptionPlan
    }

    @Get('auth-token/customer/:customerId')
    async generateAuthTokenCustomer(
        @Param('customerId') customerId: string
    ): Promise<AuthToken> {
        // Logic to generate auth token for a customer
        const authToken = await this.paymentService.generateAuthTokenCustomer(customerId);
        if (!authToken) {
            throw new NotFoundException(`Auth token for customer with ID ${customerId} not found`);
        }
        return authToken;
    }

    @Patch('upgrade-subscription/:subscriptionId')
    async upgradeSubscription(
        @Param('subscriptionId') subscriptionId: string
    ): Promise<boolean> {
        // Logic to upgrade a subscription
        const upgradedSubscription = await this.paymentService.upgradeSubscription(subscriptionId);
        if (!upgradedSubscription) {
            throw new NotFoundException(`Subscription with ID ${subscriptionId} not found`);
        }
        return upgradedSubscription;
    }

    @Patch('downgrade-subscription/:subscriptionId')
    async downgradeSubscription(
        @Param('subscriptionId') subscriptionId: string
    ): Promise<boolean> {
        // Logic to downgrade a subscription
        const downgradedSubscription = await this.paymentService.downgradeSubscription(subscriptionId);
        if (!downgradedSubscription) {
            throw new NotFoundException(`Subscription with ID ${subscriptionId} not found`);
        }
        return downgradedSubscription;
    }

    @Patch('reactivate-subscription/:subscriptionId')
    async reactivateSubscription(
        @Param('subscriptionId') subscriptionId: string
    ): Promise<boolean> {
        // Logic to reactivate a subscription
        const reactivatedSubscription = await this.paymentService.reactivateSubscription(subscriptionId);
        if (!reactivatedSubscription) {
            throw new NotFoundException(`Subscription with ID ${subscriptionId} not found`);
        }
        return reactivatedSubscription;
    }
}