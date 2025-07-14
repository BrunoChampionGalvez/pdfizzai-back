import { Injectable } from "@nestjs/common";
import { PaymentService } from "./payment.service";

@Injectable()
export class WebhooksService {
    constructor(
        private readonly paymentService: PaymentService,
    ) {}

    async handlePaddleWebhook(payload: any): Promise<string> {
        switch (payload.event_type) {
            case 'subscription.created':
                // Handle subscription created event
                return await this.paymentService.subscriptionCreated(payload);
            case 'transaction.completed':
                // Handle transaction completed event
                return this.paymentService.transactionCompleted(payload);
            case 'subscription.updated':
                // Handle subscription updated event
                return this.paymentService.subscriptionUpdated(payload);
            case 'subscription.canceled':
                // Handle subscription canceled event
                return this.paymentService.subscriptionCanceled(payload);
            default:
                // Handle unknown event type
                console.warn(`Unhandled event type: ${payload.event_type}`);
                return 'Unknown event type';
    }

        return 'Webhook handled successfully';
    }
}