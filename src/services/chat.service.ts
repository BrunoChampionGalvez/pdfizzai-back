import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatMessage, FileCitation, MessageRole } from '../entities/chat-message.entity';
import { CreateChatSessionDto, SendMessageDto, ChatResponseDto, ChatReference } from '../dto/chat.dto';
import { AIService } from './ai.service';
import { FileService } from './file.service';
import { FolderService } from './folder.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private chatSessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private chatMessageRepository: Repository<ChatMessage>,
    private readonly aiService: AIService,
    private readonly fileService: FileService,
    private readonly folderService: FolderService,
  ) {}

  async findSessionById(id: string, userId: string): Promise<ChatSession> {
    const session = await this.chatSessionRepository.findOne({
      where: { id, user_id: userId },
      relations: ['messages']
    });

    if (!session) {
      throw new NotFoundException(`Chat session with ID ${id} not found`);
    }

    return session;
  }

  async createChatSession(userId: string, createChatSessionDto: CreateChatSessionDto): Promise<ChatSession> {
    const session = this.chatSessionRepository.create({
      user_id: userId,
    });

    return this.chatSessionRepository.save(session);
  }

  async *sendMessage(
    sessionId: string,
    userId: string,
    content: string,
    previousSessionsIds: string[] = [],
    fileIds: string[] = [],
    folderIds: string[] = [],
    selectedMaterials: any[] = [],
  ): AsyncGenerator<string> {
    // Get file contents variables we'll need regardless of try/catch flow
    let fileContents: Array<{
      id: string;
      name: string;
      content: string;
      originalName: string;
    }> = [];
    let newFileContents: Array<{
      id: string;
      name: string;
      content: string;
      originalName: string;
    }> = [];

    // Create message variables outside try so we can reference them in catch
    let userMessage: ChatMessage;
    let session: ChatSession;
    let updatedSession: ChatSession;
    let messages: ChatMessage[] = [];

    // Create a session context object we can use throughout the method
    let sessionContext: ChatSession & {
      previousSessionsIds: string[];
      contextFileIds: string[];
    };

    try {
      // Validate session exists and belongs to user
      session = await this.findSessionById(sessionId, userId);

      if (!session) {
        throw new Error(
          `Session with ID ${sessionId} not found or does not belong to user ${userId}`,
        );
      }

      /*if (session.nameWasAiGenerated === false) {
        session.name = await this.aiService.generateSessionName(content);
        session.nameWasAiGenerated = true;
        await this.chatSessionRepository.save(session);
      }*/

      console.log(
        `Processing message for session ${sessionId}, user ${userId}`,
      );

      // Setup session context
      sessionContext = {
        ...session,
        previousSessionsIds,
        contextFileIds: [...new Set([...session.contextFileIds, ...fileIds])],
      };
    } catch (error: unknown) {
      console.error('Error processing message:', error);
      let errorMessage =
        'An unknown error occurred while processing your message.';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      yield JSON.stringify({
        error: 'Error processing your message: ' + errorMessage,
      });
      return; // Exit the generator
    }

    if (
      sessionContext.contextFileIds &&
      sessionContext.contextFileIds.length > 0
    ) {
      const files = await Promise.all(
        sessionContext.contextFileIds.map((fileId) =>
          this.fileService.findOneForChat(fileId),
        ),
      );

      fileContents = files.map((file) => ({
        id: file.id,
        name: file.filename,
        content: file.textByPages || 'No content available',
        originalName: file.originalName,
      }));
    }

    if (folderIds && folderIds.length > 0) {
      const files = await Promise.all(
        folderIds.map((folderId) =>
          this.folderService.findAllFilesRecursively(folderId, userId),
        ),
      );

      newFileContents = files.flat().map((file) => ({
        id: file.id,
        name: file.filename,
        content: file.textByPages || 'No content available',
        originalName: file.originalName,
      }));

      fileIds = [...fileIds, ...files.flat().map((file) => file.id)];
    }
    fileContents = [...fileContents, ...newFileContents];

    fileContents = fileContents.filter((value, index, self) => {
      const isDuplicate =
        self.findIndex((item) => item.id === value.id) !== index;
      return !isDuplicate;
    });

    fileIds = [...new Set(fileIds)];

    let extractedContent: Array<{
      fileId: string;
      name: string;
      content: string;
    }> = [];
    const category = await this.aiService.userQueryCategorizer(content);
    if (content) {
      if (fileIds.length > 0) {
        if (category === 'SPECIFIC') {
          const searchResults = await this.aiService.semanticSearch(
            content,
            userId,
          );
          extractedContent = [
            ...extractedContent,
            ...searchResults.map((result) => ({
              fileId: (result.fields as { fileId: string }).fileId,
              name: (result.fields as { name: string; chunk_text: string })
                .name,
              content: (result.fields as { name: string; chunk_text: string })
                .chunk_text,
              userId: (result.fields as { userId: string }).userId,
            })).filter((result) => {
              return result.userId === userId;
            }),
          ];

          fileContents = [];
        } else {
          fileContents = fileContents.slice(0, 4);
        }
      } else {
        if (category === 'SPECIFIC') {
          const searchResults = await this.aiService.semanticSearch(
            content,
            userId,
          );
          extractedContent = [
            ...extractedContent,
            ...searchResults.map((result) => ({
              fileId: (result.fields as { fileId: string }).fileId,
              name: (result.fields as { name: string; chunk_text: string })
                .name,
              content: (result.fields as { name: string; chunk_text: string })
                .chunk_text,
              userId: (result.fields as { userId: string }).userId,
            })).filter((result) => {
              return result.userId === userId;
            }),
          ];
        } else {
          fileContents = [];
          extractedContent = [];
        }
      }

      console.log(
        '🎯 Chat Service: Starting sendMessage for session',
        sessionId,
      );

      const extractedFileContentsStr =
        extractedContent.length > 0
          ? extractedContent
              .map(
                (file) =>
                  `File name: ${file.name} Content: ${file.content} File Id: ${file.fileId}`,
              )
              .join('\n')
          : 'No extracted content from files provided for this message';

      // Convert array objects to strings for AI service
      const fileContentsStr =
        fileContents.length > 0
          ? fileContents
              .map(
                (file) =>
                  `File title: ${file.name}\nFile original name: ${file.originalName}\nContent: ${file.content}\nFile Id: ${file.id}`,
              )
              .join('\n\n')
          : 'No files context provided for this message';

      console.log('📝 Chat Service: Converted content arrays to strings');
      console.log(
        `📊 Chat Service: fileContentsStr length: ${fileContentsStr.length}`,
      );
      console.log(
        `📊 Chat Service: extractedFileContentsStr length: ${extractedFileContentsStr.length}`,
      );

      const context = `\nFile Content Context: ${fileContentsStr}\nExtracted File Content Context: ${extractedFileContentsStr}`;

      // Remove messages from session to avoid circular reference issues
      (session as any).messages = undefined;

      // Create user message - ensure chatSessionId is set
      userMessage = this.chatMessageRepository.create({
        role: MessageRole.USER,
        content: content,
        session: session,
        session_id: sessionId, // Explicit assignment
        selectedMaterials: selectedMaterials,
      });

      console.log(`Saving user message for session ${sessionId}`);
      await this.chatMessageRepository.save(userMessage);

      // Double-check that the message was saved with the correct sessionId
      const savedMessage = await this.chatMessageRepository.findOne({
        where: { id: userMessage.id },
      });

      if (!savedMessage || savedMessage.session_id !== sessionId) {
        console.error('Message not properly linked to session:', {
          messageId: userMessage.id,
          expectedSessionId: sessionId,
          actualSessionId: savedMessage?.session_id,
        });
      }

      // Get all messages for context
      updatedSession = await this.findSessionById(sessionId, userId);
      messages = updatedSession.messages || [];

      const responseGenerator = this.aiService.generateChatResponse(
        messages,
        context,
      );

      console.log('🔄 Chat Service: Got response generator from AI service');

      // Collect all yielded content
      let streamedContent = '';
      let chunkIndex = 0;

      console.log('📡 Chat Service: Starting to process streaming chunks');

      // Process the generator to yield chunks and collect complete content
      for await (const chunk of responseGenerator) {
        chunkIndex++;

        if (chunk) {
          console.log(
            `📥 Chat Service: Received chunk ${chunkIndex}, length: ${chunk.length}`,
          );
          console.log(
            `📥 Chat Service: Chunk ${chunkIndex} content: "${chunk}"`,
          );

          const beforeLength = streamedContent.length;
          streamedContent += chunk;
          const afterLength = streamedContent.length;

          console.log(
            `📊 Chat Service: Added chunk ${chunkIndex}. Before: ${beforeLength}, After: ${afterLength}, Expected: ${beforeLength + chunk.length}`,
          );

          if (afterLength !== beforeLength + chunk.length) {
            console.error(
              `❌ Chat Service: CHARACTER LOSS DETECTED! Expected ${beforeLength + chunk.length}, got ${afterLength}`,
            );
          }

          yield chunk;
          console.log(
            `✅ Chat Service: Yielded chunk ${chunkIndex} to frontend`,
          );
        } else {
          console.log(`⚠️ Chat Service: Received empty chunk ${chunkIndex}`);
        }
      }

      console.log(`🏁 Chat Service: Finished processing ${chunkIndex} chunks`);
      console.log(
        `📊 Chat Service: Final streamedContent length: ${streamedContent.length}`,
      );
      console.log(
        `📄 Chat Service: Final streamedContent preview: "${streamedContent.substring(0, 200)}..."`,
      );

      // Extract citations from the complete streamed content
      console.log('🔍 Chat Service: Starting citation extraction');
      const citations: { id: string }[] = [];
      const citationRegex = /\[REF\]([\s\S]*?)\[\/REF\]/gs;
      const citationMatches = streamedContent.match(citationRegex) || [];

      console.log(
        `🔗 Chat Service: Found ${citationMatches.length} citation matches`,
      );

      for (const match of citationMatches) {
        try {
          // Extract just the content between [REF] and [/REF] tags
          const contentMatch = match.match(/\[REF\]([\s\S]*?)\[\/REF\]/i);
          if (contentMatch && contentMatch[1]) {
            const jsonContent = contentMatch[1].trim();
            console.log(
              `🔗 Chat Service: Parsing citation JSON: "${jsonContent}"`,
            );
            const citation = JSON.parse(jsonContent) as { id: string };
            citations.push(citation);
            console.log(
              `✅ Chat Service: Successfully parsed citation:`,
              citation,
            );
          }
        } catch (e) {
          console.error('❌ Chat Service: Failed to parse citation JSON:', e);
          console.log('❌ Chat Service: Problematic content:', match);
        }
      }

      // Ensure we have valid content
      const finalContent =
        streamedContent ||
        'Sorry, I encountered an error while processing your request.';

      console.log(
        `💾 Chat Service: About to save message with content length: ${finalContent.length}`,
      );

      // Transform AICitation objects to entity citation types
      const transformedEntityCitations = await Promise.all(
        citations.map(async (citation: { id: string }) => {
          try {
            const pathOrName = await this.getReferencePathById(
              citation,
              userId,
            );

            if (citation) {
              return {
                id: citation.id,
                text: pathOrName, // pathOrName is the file path
              } as FileCitation;
            }
            return null;
          } catch (e: unknown) {
            // Typed error object
            let message = 'Unknown error during citation transformation';
            if (e instanceof Error) {
              message = e.message;
            }
            console.error(
              `Error transforming citation (id: ${citation.id}): ${message}`,
              e, // Log the original error object for more details
            );
            return null;
          }
        }),
      );

      const finalCitations = transformedEntityCitations.filter(
        (c) => c !== null,
      );

      // Create AI message with the final content and citations
      const aiMessage = this.chatMessageRepository.create({
        role: MessageRole.MODEL,
        content: finalContent,
        context: context,
        citations: finalCitations,
        session_id: sessionId,
        session: session,
      });

      await this.chatMessageRepository.save(aiMessage);
      console.log(
        `✅ Chat Service: Successfully saved AI message with ID: ${aiMessage.id}`,
      );

      // Update session with new context file IDs
      if (sessionContext.contextFileIds.length > 0) {
        session.contextFileIds = sessionContext.contextFileIds;
        await this.chatSessionRepository.save(session);
        console.log(`✅ Chat Service: Updated session with context file IDs: ${sessionContext.contextFileIds.join(', ')}`);
      }

      return { message: userMessage, aiResponse: aiMessage };
    } else {
      throw new BadRequestException('Empty user message');
    }
  }

  async getChatHistory(userId: string, sessionId: string): Promise<ChatMessage[]> {
    // Verify session belongs to user
    const session = await this.chatSessionRepository.findOne({
      where: { id: sessionId, user_id: userId },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    // Query messages with additional user verification through session
    return this.chatMessageRepository.find({
      where: { session_id: sessionId },
      relations: ['session'],
      order: { created_at: 'ASC' },
    }).then(messages => 
      // Double-check that all messages belong to sessions owned by the correct user
      messages.filter(message => message.session?.user_id === userId)
    );
  }

  async getReferencePathById(
    reference: { id: string }, // Fixed type annotation
    userId: string,
  ): Promise<string> {
    const { id: referenceId } = reference;
    try {
      console.log(
        `Getting file using enhanced lookup for ID: ${referenceId}`,
      );
      const file = await this.fileService.findOne(
        referenceId,
      );
      // If we found the file, now get its path
      console.log(`File found, getting path for file ID: ${file.id}`);
      return await this.fileService.getFilePath(file.id, userId);
    } catch (error) {
      console.error(
        `Enhanced file lookup failed for ${referenceId}, falling back to direct path lookup:`,
        error,
      );
      // Fall back to direct path lookup
      return await this.fileService.getFilePath(referenceId, userId);
    }
  }

  async getUserChatSessions(userId: string): Promise<ChatSession[]> {
    return this.chatSessionRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  async getFilePathById(
    fileId: string, // Fixed parameter name and type
    userId: string,
  ): Promise<string> {
        try {
          const file = await this.fileService.findOne(
            fileId,
          );
          // If we found the file, now get its path
          console.log(`File found, getting path for file ID: ${file.id}`);
          return this.fileService.getFilePath(file.id, userId);
        } catch (error) {
          return this.fileService.getFilePath(fileId, userId);
        }
  }

  async loadReferenceAgain(
    referenceId: string,
    chatMessageId: string,
    chatMessage: string,
    textToSearch: string,
  ): Promise<string> {
    console.log(`Searching for reference in chat message: ${chatMessage}`);
    
    // Use AI service to search for the reference
    try {
      /*const oldChatMessage = await this.chatMessageRepository.findOne({
        where: { id: chatMessageId },
        select: ['context'],
      });

      if (!oldChatMessage) {
        throw new NotFoundException(`Chat message with ID ${chatMessageId} not found`);
      }*/

      // Fetch the file of the reference
      const file = await this.fileService.findOne(referenceId);
      if (!file) {
        throw new NotFoundException(`File with ID ${referenceId} not found`);
      }

      // Convert all new line characters in context to a single space
      const normalizedContext = file.textByPages.replace(/\r?\n|\r/g, ' ');

      const response = await this.aiService.loadReferenceAgain(textToSearch, normalizedContext);
      console.log(`AI search response: ${response}`);
      // Escape newlines in textToSearch for literal replacement
      const escapedTextToSearch = textToSearch.replace(/\n/g, '\\n');
      const escapedResponse = response.replace(/\n/g, '\\n');
      const newChatMessage = chatMessage.replace(
        escapedTextToSearch,
        escapedResponse, // Replace the original text with the AI's response
      );
      const updatedMessage = await this.chatMessageRepository.save({
        id: chatMessageId,
        content: newChatMessage,
      });
      return updatedMessage.content;
    } catch (error: unknown) {
      console.error('Error searching reference:', error);
      let errorMessage = 'Unknown error during reference search';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message: unknown }).message === 'string'
      ) {
        errorMessage = (error as { message: string }).message;
      }
      throw new BadRequestException(`Failed to search reference: ${errorMessage}`);
    }
  }
}
