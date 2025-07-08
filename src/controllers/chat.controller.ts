import { Controller, Post, Get, Body, Param, UseGuards, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ChatService } from '../services/chat.service';
import { CreateChatSessionDto, SendMessageDto } from '../dto/chat.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('api/chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('start')
  async startChatSession(
    @Req() req: Request & { user: any },
    @Body() createChatSessionDto: CreateChatSessionDto,
  ) {
    return this.chatService.createChatSession(req.user.userId, createChatSessionDto);
  }

  @Post(':sessionId/message')
  async sendMessage(
    @Param('sessionId') sessionId: string, // Fixed parameter name to match route
    @Body() messageDto: SendMessageDto,
    @Req() req: Request & { user: any },
    @Res() res: Response,
  ) {
    console.log('Message request received for session:', sessionId); // Updated variable name

    // Set appropriate headers for SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering if applicable
    res.flushHeaders(); // Important to send headers immediately

    // Initial validation: verify the session exists before proceeding
    try {
      // Verify that the session exists and belongs to the user
      const session = await this.chatService.findSessionById(sessionId, req.user.id);

      // Additional verification to ensure we have a valid session ID
      if (!session || !session.id) {
        const errorMsg = `Invalid session: ${!session ? 'not found' : 'missing ID'}`;
        console.error(errorMsg);
        res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
        res.end();
        return;
      }

      console.log(
        `Session validated successfully: ${session.id} (${session.name || 'unnamed'})`,
      );

      // Ensure the content is not empty
      if (!messageDto.content || messageDto.content.trim() === '') {
        res.write(
          `data: ${JSON.stringify({ error: 'Message content cannot be empty' })}\n\n`,
        );
        res.end();
        return;
      }

      console.log('Starting message processing with verified session ID:', sessionId); // Updated variable name

      try {
        // Get the message generator from service
        const generator = this.chatService.sendMessage(
          sessionId, // Updated variable name
          req.user.userId,
          messageDto.content,
          messageDto.previousSessionsIds || [],
          messageDto.fileIds || [],
          messageDto.folderIds || [],
          messageDto.selectedMaterials || [],
        );

        // Stream each chunk as it's generated
        for await (const chunk of generator) {
          // Log occasionally to monitor progress
          if (Math.random() < 0.05) {
            // Log ~5% of chunks to avoid excessive logging
            console.log(
              `Streaming chunk for session ${sessionId}:`, // Updated variable name
              chunk.substring(0, 20) + (chunk.length > 20 ? '...' : ''),
            );
          }

          // Proper SSE format for Server-Sent Events - send chunk as JSON string
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        console.log('Message stream completed for session:', sessionId); // Updated variable name
      } catch (streamError: unknown) {
        // Handle errors during streaming
        console.error(
          `Error streaming response for session ${sessionId}:`, // Updated variable name
          streamError,
        );
        let errorMessageString = 'Unknown streaming error';
        if (streamError instanceof Error) {
          errorMessageString = streamError.message;
        } else if (typeof streamError === 'string') {
          errorMessageString = streamError;
        }

        // If it's a database constraint error, provide more helpful information
        if (
          errorMessageString.includes('violates not-null constraint') &&
          errorMessageString.includes('chatSessionId')
        ) {
          console.error(
            'Database constraint violation: chatSessionId cannot be null',
          );
          res.write(
            `data: ${JSON.stringify({
              error:
                'Database error: Unable to associate message with chat session',
            })}\n\n`,
          );
        } else {
          res.write(
            `data: ${JSON.stringify({
              error: `Error generating response: ${errorMessageString}`,
            })}\n\n`,
          );
        }
      }
    } catch (error: unknown) {
      // Handle any other errors
      console.error('Error in message endpoint:', error);
      let errorMessageString = 'Unknown error';
      if (error instanceof Error) {
        errorMessageString = error.message;
      } else if (typeof error === 'string') {
        errorMessageString = error;
      }

      try {
        res.write(`data: ${JSON.stringify({ error: errorMessageString })}\n\n`);
      } catch (responseError) {
        console.error('Failed to send error response:', responseError);
      }
    } finally {
      // Always ensure the response is ended
      try {
        res.end();
        console.log('Response ended for session:', sessionId); // Updated variable name
      } catch (endError) {
        console.error('Error ending response:', endError);
      }
    }
  }

  @Get(':sessionId/history')
  async getChatHistory(
    @Req() req: Request & { user: any },
    @Param('sessionId') sessionId: string,
  ) {
    return this.chatService.getChatHistory(req.user.userId, sessionId);
  }

  @Get('sessions')
  async getUserChatSessions(@Req() req: Request & { user: any }) {
    return this.chatService.getUserChatSessions(req.user.userId);
  }

  @Post('load-reference-again/:messageId')
  async searchReferenceAgain(
    @Body() body: { textToSearch: string, chatMessage: string },
    @Req() req: Request & { user: any },
    @Param('messageId') messageId: string,
  ): Promise<string> {
    console.log(
      `Searching reference again for user ${req.user.id} with text: "${body.textToSearch}"`,
    );
    try {
      const result = await this.chatService.loadReferenceAgain(
        messageId,
        body.chatMessage,
        body.textToSearch,
      );
      console.log(
        `Search result for user ${req.user.userId}: "${result.substring(0, 50)}..."`,
      );
      return result;
    } catch (error: unknown) {
      console.error(
        `Error searching reference again for user ${req.user.id}:`,
        error,
      );
      throw error; // Let the global error handler catch this
    }
  }

  @Get('reference-path/:id')
  async getReferencePath(
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
  ): Promise<{ path: string }> {
    try {
      console.log(
        `Getting reference path for file ${id}, for user ${req.user.id}`,
      );
      const path = await this.chatService.getReferencePathById(
        { id }, // Wrap the id in an object to match the expected parameter type
        req.user.id,
      );
      return { path };
    } catch (e: unknown) {
      let statusCode: number | undefined;
      let message: string = 'Not found'; // Default message for 404 case

      if (typeof e === 'object' && e !== null) {
        const error = e as {
          response?: { statusCode?: number; message?: string };
          status?: number;
          message?: string;
        };
        statusCode = error.response?.statusCode ?? error.status;
        if (statusCode === 404) {
          message = error.response?.message ?? error.message ?? 'Not found';
        } else {
          message = error.message ?? 'Unknown error getting reference path';
        }
      } else if (typeof e === 'string') {
        message = e;
      }

      // Check if it's a common NotFoundException (for missing references)
      if (statusCode === 404) {
        // Log a simplified message without the full stack trace
        console.log(`Reference not found: ${id} - ${message}`);
        return { path: `[Deleted]` };
      } else {
        // For other errors, log with full details but don't assume the file is deleted
        console.error(`Error getting reference path for ${id}:`, e);

        // For other types of errors, return a different message indicating it might be an access issue
        return { path: `[Error accessing]` };
      }
    }
  }
}
