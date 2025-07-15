import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { WebhooksService } from "src/services/webhooks.service";

@Controller("api/webhooks")
export class WebhooksController {
    constructor(private webhooksService: WebhooksService) {}

    @HttpCode(200)
    @Post("paddle")
    handlePaddleWebhook(
        @Body() payload: any
    ): Promise<string> {
        console.log(`Received Paddle webhook: ${JSON.stringify(payload)}`);
        
        const result = this.webhooksService.handlePaddleWebhook(payload);
        return result;
    }
}