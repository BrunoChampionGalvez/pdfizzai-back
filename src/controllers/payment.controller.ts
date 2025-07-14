import { Controller, Param, Put } from "@nestjs/common";
import { PaymentService } from "src/services/payment.service";

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
}