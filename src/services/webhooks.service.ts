import { Injectable, Logger } from "@nestjs/common";
import { PaymentService } from "./payment.service";

@Injectable()
export class WebhooksService {
    private readonly logger = new Logger(WebhooksService.name);

    constructor(
        private readonly paymentService: PaymentService,
    ) {}

    async handlePaddleWebhook(payload: any): Promise<string> {
        this.logger.log(`Received webhook event: ${payload.event_type}`);
        
        switch (payload.event_type) {
            case 'subscription.created':
                // Handle subscription created event
                return await this.paymentService.subscriptionCreated(payload);
            case 'transaction.completed':
                // Handle transaction completed event
                return await this.paymentService.transactionCompleted(payload);
            case 'subscription.updated':
                // Handle subscription updated event
                return await this.paymentService.subscriptionUpdated(payload);
            case 'subscription.canceled':
                // Handle subscription canceled event
                return await this.paymentService.subscriptionCanceled(payload);
            default:
                // Handle unknown event type
                this.logger.warn(`Unhandled event type: ${payload.event_type}`);
                return 'Unknown event type';
        }
    }
}