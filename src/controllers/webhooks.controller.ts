import { Body, Controller, Post } from "@nestjs/common";
import { WebhooksService } from "src/services/webhooks.service";

@Controller("api/webhooks")
export class WebhooksController {
    constructor(private webhooksService: WebhooksService) {}

    @Post("paddle")
    handlePaddleWebhook(
        @Body() payload: any
    ): Promise<string> {
        const result = this.webhooksService.handlePaddleWebhook(payload);
        return result;
    }
}