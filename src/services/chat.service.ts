import { BadRequestException, Injectable, NotFoundException, UnauthorizedException, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ChatSession } from '../entities/chat-session.entity'
import { ChatMessage, FileCitation, MessageRole } from '../entities/chat-message.entity'
import { CreateChatSessionDto, SendMessageDto, ChatResponseDto, ChatReference } from '../dto/chat.dto'
import { AIService } from './ai.service'
import { FileService } from './file.service'
import { FolderService } from './folder.service'
import { PaymentService } from './payment.service'
import { RawExtractedContent } from 'src/entities/raw-extracted-contents'
import { ExtractedContent } from 'src/entities/extracted-content.entity'

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)

  constructor(
    @InjectRepository(ChatSession)
    private chatSessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(RawExtractedContent)
    private rawExtractedContentsRepository: Repository<RawExtractedContent>,
    @InjectRepository(ExtractedContent)
    private extractedContentRepository: Repository<ExtractedContent>,
    private readonly aiService: AIService,
    private readonly fileService: FileService,
    private readonly folderService: FolderService,
    private readonly paymentService: PaymentService,
  ) {}

  /**
   * Called on application startup to check for and recover orphaned conversations
   * This helps maintain conversation integrity across system restarts
   */
  async onApplicationStartup(): Promise<void> {
    try {
      this.logger.log('Checking for orphaned conversations on startup...');
      
      // Find all sessions that might have orphaned user messages
      // Look for sessions where the last message is a user message created more than 5 minutes ago
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const suspiciousSessions = await this.chatSessionRepository
        .createQueryBuilder('session')
        .leftJoin('session.messages', 'message')
        .where('message.created_at < :fiveMinutesAgo', { fiveMinutesAgo })
        .andWhere('message.role = :userRole', { userRole: MessageRole.USER })
        .groupBy('session.id')
        .having('MAX(message.created_at) = message.created_at') // Last message in session
        .andHaving('message.role = :userRole', { userRole: MessageRole.USER })
        .getMany();

      if (suspiciousSessions.length > 0) {
        this.logger.warn('Found ' + suspiciousSessions.length + ' sessions that may have orphaned messages');
        
        for (const session of suspiciousSessions) {
          try {
            const integrityCheck = await this.checkConversationIntegrity(session.id, session.user_id);
            
            if (!integrityCheck.isHealthy && integrityCheck.orphanedMessages.length > 0) {
              this.logger.warn('Attempting to recover orphaned messages in session ' + session.id);
              const recovery = await this.recoverConversationIntegrity(session.id, session.user_id);
              
              if (recovery.success) {
                this.logger.log('Successfully recovered session ' + session.id);
              } else {
                this.logger.error('Failed to fully recover session ' + session.id + '. Remaining issues: ' + recovery.remainingIssues.join(', '));
              }
            }
          } catch (error) {
            this.logger.error('Error checking/recovering session ' + session.id + ':', error);
          }
        }
      } else {
        this.logger.log('No orphaned conversations detected');
      }
    } catch (error) {
      this.logger.error('Error during startup conversation integrity check:', error);
      // Don't throw - this shouldn't prevent the application from starting
    }
  }

  async findSessionById(id: string, userId: string): Promise<ChatSession> {
    const session = await this.chatSessionRepository.findOne({
      where: { id, user_id: userId },
      relations: ['messages', 'messages.extractedContents'],
      order: {
        messages: {
          created_at: 'ASC'
        }
      }
    });

    if (!session) {
      throw new NotFoundException('Chat session with ID ' + id + ' not found');
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
      summary: string;
      originalName: string;
    }> = [];
    let newFileContents: Array<{
      id: string;
      name: string;
      summary: string;
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

      messages = session.messages

      if (!session) {
        throw new Error(
          'Session with ID ' + sessionId + ' not found or does not belong to user ' + userId,
        );
      }

      /*if (session.nameWasAiGenerated === false) {
        session.name = await this.aiService.generateSessionName(content);
        session.nameWasAiGenerated = true;
        await this.chatSessionRepository.save(session);
      }*/

      console.log(
        'Processing message for session ' + sessionId + ', user ' + userId,
      );

      // Setup session context
      sessionContext = {
        ...session,
        previousSessionsIds,
        contextFileIds: [...new Set([...session.contextFileIds, ...fileIds])],
      };

      if (fileIds.length > 0) {
        fileIds = fileIds
      } else {
        fileIds = session.contextFileIds;
      }
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

    // if (
    //   sessionContext.contextFileIds &&
    //   sessionContext.contextFileIds.length > 0
    // ) {
    //   const files = await Promise.all(
    //     sessionContext.contextFileIds.map((fileId) =>
    //       this.fileService.findOneForChat(fileId),
    //     ),
    //   );

    //   fileContents = files.map((file) => ({
    //     id: file.id,
    //     name: file.filename,
    //     content: file.textByPages || 'No content available',
    //     originalName: file.originalName,
    //   }));
    // }

    if (fileIds && fileIds.length > 0) {
      const files = await Promise.all(
        fileIds.map((fileId) =>
          this.fileService.findOneForChat(fileId),
        ),
      );
      fileContents = files.map((file) => ({
        id: file.id,
        name: file.filename,
        summary: file.summary || 'No content available',
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
        summary: file.summary || 'No content available',
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
      rawRefId: number;
      fileId: string;
      name: string;
      content: string;
      userId: string;
    }> = [];

    let rawExtractedContents: RawExtractedContent[] = [];
    
    // Optimization 1: Parallel processing and batching
    const queries = await this.aiService.userQueryCategorizer(content);
    let questions: string[] = [];
    const queriesArray = queries.queries;
  
    // Optimized: Batch specific queries processing
    questions.push(...queriesArray)
    // Optimized: Batch question generation and parallel processing
    const allGenericPromises: Promise<{fileId: string; fileName: string; text: string; userId: string}[]>[] = []
    const allRawContentPromises: Promise<RawExtractedContent[]>[] = []
    
    this.logger.debug('Optimized: Batch question generation and parallel processing');
        
    // Batch all question generation requests first
    const questionGenerationPromises = queriesArray.map(query => 
      this.aiService.generateQuestionsFromQuery(query, messages.slice(-5), fileContents)
    )
    
    const allQuestionResults = await Promise.all(questionGenerationPromises)
    
    this.logger.debug('All question generation requests processed in parallel');

    // Process all questions in optimized batches
    // Create all search promises for all query-file combinations at once
    const allSearchPromises: Promise<any>[] = []
    const searchMetadata: { query: string; question: string; file: any; queryIndex: number }[] = []
    
    for (let i = 0; i < queriesArray.length; i++) {
      const query = queriesArray[i]
      const questions = allQuestionResults[i]
      
      if (questions.length === 0) continue
      
      for (const file of fileContents) {
        for (const question of questions) {
          allSearchPromises.push(
            this.aiService.semanticSearch(question, userId, [file.id])
          )
          searchMetadata.push({ query, question, file, queryIndex: i })
        }
      }
    }
    
    // Execute all searches in parallel
    const allSearchResults = await Promise.all(allSearchPromises)
    
    // Process all results in parallel
    const allRawContentBatch: any[] = []
    const allFilterPromises: Promise<{fileId: string; fileName: string; text: string; userId: string}>[] = []
    
    allSearchResults.forEach((searchResult, index) => {
      const metadata = searchMetadata[index]
      
      // Collect raw content
      const rawContentForBatch = searchResult.hits.map(hit => ({
        text: (hit.fields as any).chunk_text,
        fileId: (hit.fields as any).file_id,
        fileName: (hit.fields as any).file_name,
        userId: userId,
        sessionId: sessionId,
      }))
      
      allRawContentBatch.push(...rawContentForBatch)
      
      // Create filter promise
      allFilterPromises.push(
        this.aiService.filterSearchResults(searchResult.hits, metadata.question, content)
          .then(result => ({
            fileId: result.fileId,
            fileName: result.name,
            text: result.text,
            userId: userId,
          }))
      )
    })
    
    // Batch save all raw content at once
    if (allRawContentBatch.length > 0) {
      allRawContentPromises.push(
        this.rawExtractedContentsRepository.save(allRawContentBatch)
      )
    }
    
    // Add all filter promises to the main promise array
    allGenericPromises.push(Promise.all(allFilterPromises))
    
    this.logger.debug('All filter promises added to main promise array');

    // Execute all remaining operations in parallel
    const [resultsGenericQueries, allRawContents] = await Promise.all([
      Promise.all(allGenericPromises).then(results => results.flat()),
      Promise.all(allRawContentPromises).then(results => results.flat())
    ])

    this.logger.debug('All remaining operations executed in parallel');
    
    // Update the rawExtractedContents variable with all batch results
    rawExtractedContents = [...rawExtractedContents, ...allRawContents]

    let numRawReferences = session.numRawReferences

    extractedContent = [...extractedContent, ... resultsGenericQueries.map((result) => {
      numRawReferences++
      return {
        fileId: result.fileId,
        rawRefId: numRawReferences,
        name: result.fileName,
        content: result.text,
        userId: userId,
      }
    })]

    await this.chatSessionRepository.update(sessionId, {
      numRawReferences: numRawReferences,
    })

      console.log(
        '🎯 Chat Service: Starting sendMessage for session',
        sessionId,
      );

      const savedExtractedContent = await this.fileService.saveExtractedContent(
        session,
        sessionId,
        userId,
        extractedContent,
      );

      this.logger.debug('Extracted content saved successfully');

      // Remove messages from session to avoid circular reference issues
      (session as any).messages = undefined;

      // Create user message - ensure chatSessionId is set
      userMessage = new ChatMessage();
      userMessage.role = MessageRole.USER;
      userMessage.content = content;
      userMessage.questions = questions;
      userMessage.session = session;
      userMessage.session_id = sessionId;
      userMessage.selectedMaterials = selectedMaterials;
      
      // Properly set up the relationship with extractedContents
      if (savedExtractedContent && savedExtractedContent.length > 0) {
        userMessage.extractedContents = savedExtractedContent;
      }

      for (const fileContent of fileContents) {
        const file = await this.fileService.findOneForChat(
          fileContent.id,
        );

        file.referencedMessages.push(userMessage);
        await this.fileService.save(file);
      }

      this.logger.debug('Saving user message for session ' + sessionId);
      
      // Debug: Log user message details before saving
      console.log('🔍 Chat Service: About to save user message with details:', {
        id: userMessage.id,
        session_id: userMessage.session_id,
        role: userMessage.role,
        content: userMessage.content?.substring(0, 100) + '...',
        hasSession: !!userMessage.session,
        sessionId: userMessage.session?.id,
        hasExtractedContents: !!userMessage.extractedContents,
        extractedContentsLength: userMessage.extractedContents?.length || 0,
        hasQuestions: !!userMessage.questions,
        questionsLength: userMessage.questions?.length || 0,
        hasSelectedMaterials: !!userMessage.selectedMaterials,
        selectedMaterialsLength: userMessage.selectedMaterials?.length || 0
      });
      
      try {
        await this.chatMessageRepository.save(userMessage);
        console.log('✅ Chat Service: User message saved successfully with ID:', userMessage.id);
      } catch (saveError) {
        console.error('❌ Chat Service: Failed to save user message:', {
          error: saveError,
          errorName: saveError instanceof Error ? saveError.name : 'Unknown',
          errorMessage: saveError instanceof Error ? saveError.message : 'Unknown error',
          userMessageData: {
            id: userMessage.id,
            session_id: userMessage.session_id,
            role: userMessage.role,
            hasContent: !!userMessage.content
          }
        });
        throw saveError;
      }

      // Send the user message ID to frontend
      yield '[USER_MESSAGE_ID]' + userMessage.id + '[/USER_MESSAGE_ID]';

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

      // Check for orphaned user messages (user messages without corresponding assistant responses)
      // This can happen if the system failed after saving the user message but before saving the AI response
      const lastMessage = messages[messages.length - 1];
      const hasOrphanedUserMessage = lastMessage && 
        lastMessage.role === MessageRole.USER && 
        lastMessage.id !== userMessage.id; // Not the message we just created

      if (hasOrphanedUserMessage) {
        console.warn('⚠️ Chat Service: Detected orphaned user message (ID: ' + lastMessage.id + '). This may indicate a previous system failure.');
        // You could implement recovery logic here, such as:
        // 1. Generate a response to the orphaned message
        // 2. Log the incident for monitoring
        // 3. Notify the user about the recovered conversation
      }

      // Calculate how many messages to include based on 5-message chunks
      const messageCount = messages.length;
      const messageChunkSize = 5;
      const numChunks = Math.floor(messageCount / messageChunkSize);
      const remainingMessages = messageCount % messageChunkSize;
      
      // If we have less than 5 messages, send all of them
      // Otherwise, send only the remainder after the last complete chunk
      const messagesToSend = messageCount <= messageChunkSize 
        ? messages
        : messages.slice(-(remainingMessages || messageChunkSize));

      console.log('📡 Chat Service: Starting to stream response from AI service');

      let streamedContent: string = ''
      let chunkIndex = 0;

      // Stream the response from AI service and apply reference replacements progressively
      for await (const chunk of this.aiService.generateChatResponseStream(messagesToSend, questions)) {
        chunkIndex++;
        streamedContent += chunk;
        
        console.log(
           '📥 Chat Service: Chunk ' + chunkIndex + ' content: "' + streamedContent + '"',
         );
         
         yield chunk;
         console.log(
           '✅ Chat Service: Yielded chunk ' + chunkIndex + ' to frontend',
         );
       }

      const citations: { id: string }[] = [];
      const citationRegex = /\[REF\]([\s\S]*?)\[\/REF\]/gs;
      const citationMatches = streamedContent.match(citationRegex) || [];

      console.log(
        '🔗 Chat Service: Found ' + citationMatches.length + ' citation matches',
      );

      for (const match of citationMatches) {
        try {
          // Extract just the content between [REF] and [/REF] tags
          const contentMatch = match.match(/\[REF\]([\s\S]*?)\[\/REF\]/i);
          if (contentMatch && contentMatch[1]) {
            const jsonContent = contentMatch[1].trim();
            console.log(
              '🔗 Chat Service: Parsing citation JSON: "' + jsonContent + '"',
            );
            const citation = JSON.parse(jsonContent) as { id: string };
            citations.push(citation);
            console.log(
              '✅ Chat Service: Successfully parsed citation:',
              citation,
            );
          }
        } catch (e) {
          console.error('❌ Chat Service: Failed to parse citation JSON:', e);
          console.log('❌ Chat Service: Problematic content:', match);
        }
      }

      // Apply final reference replacements to the complete streamed content
      let finalContent = streamedContent;

      console.log(
        '💾 Chat Service: About to save message with content length: ' + finalContent.length,
      );
      
      // Validate that we have the required data for saving
      if (!sessionId || !userId) {
        throw new Error('Missing required session ID or user ID for saving message');
      }
      
      if (!session || !session.id) {
        throw new Error('Invalid session object for saving message');
      }

      // Transform AICitation objects to entity citation types
      const transformedEntityCitations = await Promise.all(
        citations.map(async (citation: { id: string }) => {
          try {
            // The citation.id should be a rawRefId (numeric), not a file ID
            const rawRefId = parseInt(citation.id, 10);
            
            if (isNaN(rawRefId)) {
              console.error('Citation ID is not a valid rawRefId:', citation.id);
              return null;
            }
            
            // Get the extracted content using rawRefId
            const extractedContent = await this.getExtractedContentByRawRefId(
              rawRefId,
              userId,
              sessionId,
            );

            if (extractedContent) {
              return {
                id: citation.id, // Keep original citation ID
                text: extractedContent.fileName, // Use fileName as the display text
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
              'Error transforming citation (id: ' + citation.id + '): ' + message,
              e, // Log the original error object for more details
            );
            return null;
          }
        }),
      );

      const finalCitations = transformedEntityCitations.filter(
        (c) => c !== null,
      );
      
      // Validate citations data
      for (const citation of finalCitations) {
        if (!citation.id || typeof citation.id !== 'string') {
          console.warn('⚠️ Chat Service: Invalid citation ID found:', citation);
        }
        if (!citation.text || typeof citation.text !== 'string') {
          console.warn('⚠️ Chat Service: Invalid citation text found:', citation);
        }
      }
      
      // Validate extracted contents
      if (savedExtractedContent && Array.isArray(savedExtractedContent)) {
        for (const content of savedExtractedContent) {
          if (!content.id || (typeof content.id !== 'string' && typeof content.id !== 'number')) {
            console.warn('⚠️ Chat Service: Invalid extracted content ID found:', content);
          }
        }
      }

      console.log('🔧 Chat Service: Getting subscription usage for user:', userId);
      const subscriptionUsage = await this.paymentService.getSubscriptionUsageByUser(
        userId,
      );
      console.log('🔧 Chat Service: Retrieved subscription usage:', {
        found: !!subscriptionUsage,
        id: subscriptionUsage?.id,
        messagesUsed: subscriptionUsage?.messagesUsed,
        userId: userId
      });

      let conversationSummary: string | null = null;
      
      // Check if we need to generate a conversation summary
      // We generate summaries every 5 messages, but we need to be smart about when
      const totalMessages = messages.length - 1
      const shouldGenerateSummary = totalMessages >= 4 && (totalMessages % 5 === 0 || (totalMessages + 1) % 5 === 0);
      
      if (shouldGenerateSummary) {
        // Get the last 5 messages for summary
        const messagesForSummary = messages.slice(-6, -1);
        conversationSummary = await this.aiService.generateConversationSummary(
          messagesForSummary
        );
      }

      // Create AI message with the final content and citations
      let aiMessage: ChatMessage;
      try {
        aiMessage = this.chatMessageRepository.create({
          role: MessageRole.ASSISTANT,
          content: finalContent,
          conversationSummary: conversationSummary || '',
          citations: finalCitations || [],
          session_id: sessionId,
          session: session,
          extractedContents: savedExtractedContent,
          rawExtractedContents: rawExtractedContents
        });
        // Note: extractedContents are already linked to the user message, not the AI response

        console.log('💾 Chat Service: Created AI message entity:', {
           role: aiMessage.role,
           contentLength: aiMessage.content?.length || 0,
           citationsCount: aiMessage.citations?.length || 0,
           sessionId: aiMessage.session_id,
           hasSession: !!aiMessage.session
         });
         // Note: extractedContents are linked to user message, not AI message
      } catch (entityCreationError) {
        console.error('❌ Chat Service: Failed to create AI message entity:', entityCreationError);
        throw new Error('Failed to create AI message entity: ' + (entityCreationError instanceof Error ? entityCreationError.message : 'Unknown error'));
      }

      // Use a transaction to ensure both the AI message is saved and usage is updated atomically
      let savedAiMessage: ChatMessage;
      try {
        console.log('🔧 Chat Service: Starting transaction with:', {
          hasSubscriptionUsage: !!subscriptionUsage,
          subscriptionUsageId: subscriptionUsage?.id,
          aiMessageContent: aiMessage.content?.substring(0, 100) + '...'
        });
        
        savedAiMessage = await this.chatMessageRepository.manager.transaction(async transactionalEntityManager => {
          console.log('🔧 Chat Service: Inside transaction, saving AI message');
          
          // Save the AI message within the transaction and get the saved entity
          const savedMessage = await transactionalEntityManager.save(ChatMessage, aiMessage);
          console.log('✅ Chat Service: AI message saved successfully with ID:', savedMessage.id);
          
          // Update subscription usage within the same transaction
          if (subscriptionUsage?.id) {
            console.log('🔧 Chat Service: About to call increaseMessageUsage with transactional entity manager');
            await this.paymentService.increaseMessageUsage(subscriptionUsage.id, transactionalEntityManager);
            console.log('✅ Chat Service: increaseMessageUsage completed successfully');
          } else {
            console.log('🔧 Chat Service: No subscription usage to update');
          }
          
          console.log('🔧 Chat Service: Transaction operations completed, returning saved message');
          return savedMessage;
        });
        
        console.log('✅ Chat Service: Transaction completed successfully');
        
        console.log(
          '✅ Chat Service: Successfully saved AI message with ID: ' + savedAiMessage.id,
        );
      } catch (error) {
        console.error('❌ Chat Service: Failed to save AI message in transaction:', error);
        
        // Log more details about the error
        if (error instanceof Error) {
          console.error('❌ Chat Service: Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
          });
        }
        
        // If transaction fails, we still have the user message saved
        // Mark this as an orphaned user message scenario
        console.error('⚠️ Chat Serrvice: User message ' + userMessage.id + ' may be orphaned due to AI message save failure');
        
        // You could implement retry logic here or queue for later processing
        throw error;
      }

      // Send the AI message ID to frontend
      yield '[AI_MESSAGE_ID]' + savedAiMessage.id + '[/AI_MESSAGE_ID]';
      
      // Update the aiMessage reference for the return statement
      aiMessage = savedAiMessage;


      // Update session with new context file IDs
      if (sessionContext.contextFileIds.length > 0) {
        session.contextFileIds = sessionContext.contextFileIds;
        await this.chatSessionRepository.save(session);
        console.log('✅ Chat Service: Updated session with context file IDs: ' + sessionContext.contextFileIds.join(', '));
      }

      return { message: userMessage, aiResponse: aiMessage };
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
        'Getting file using enhanced lookup for ID: ' + referenceId,
      );
      const file = await this.fileService.findOne(
        referenceId,
      );
      // If we found the file, now get its path
      console.log('File found, getting path for file ID: ' + file.id);
      return await this.fileService.getFilePath(file.id, userId);
    } catch (error) {
      console.error(
        'Enhanced file lookup failed for ' + referenceId + ', falling back to direct path lookup:',
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
          console.log('File found, getting path for file ID: ' + file.id);
          return this.fileService.getFilePath(file.id, userId);
        } catch (error) {
          return this.fileService.getFilePath(fileId, userId);
        }
  }

  async getExtractedContentByRawRefId(
    rawRefId: number,
    userId: string,
    sessionId: string,
  ): Promise<ExtractedContent> {
    // Query directly from ExtractedContent and join the owning ChatSession to filter by user and session
    const extractedContent = await this.extractedContentRepository
      .createQueryBuilder('extractedContent')
      .leftJoin('extractedContent.chatSession', 'session')
      .where('session.user_id = :userId', { userId })
      .andWhere('session.id = :sessionId', { sessionId })
      .andWhere('extractedContent.rawRefId = :rawRefId', { rawRefId })
      .select([
        'extractedContent.id',
        'extractedContent.fileId',
        'extractedContent.text',
        'extractedContent.fileName',
        'extractedContent.rawRefId',
      ])
      .getOne()

    if (!extractedContent) {
      throw new NotFoundException('Extracted content with rawRefId ' + rawRefId + ' not found for session ' + sessionId)
    }

    return extractedContent
  }

  async loadReferenceAgain(
    referenceId: string,
    chatMessageId: string,
    chatMessage: string,
    textToSearch: string,
  ): Promise<string> {
    console.log('Searching for reference in chat message: ' + chatMessage);
    
    // Use AI service to search for the reference
    try {
      const oldChatMessage = await this.chatMessageRepository.findOne({
        where: { id: chatMessageId }, relations: ['rawExtractedContents']
      });

      if (!oldChatMessage) {
        throw new NotFoundException('Chat message with ID ' + chatMessageId + ' not found');
      }

      // Fetch the file of the reference

      const response = await this.aiService.loadReferenceAgain(textToSearch, oldChatMessage.rawExtractedContents || []);
      console.log('AI search response: ' + response);
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
      throw new BadRequestException('Failed to search reference: ' + errorMessage);
    }
  }
  

  /**
   * Checks conversation integrity and identifies potential issues
   * Returns information about orphaned messages, missing responses, etc.
   */
  async checkConversationIntegrity(sessionId: string, userId: string): Promise<{
    isHealthy: boolean;
    issues: string[];
    orphanedMessages: ChatMessage[];
    totalMessages: number;
    lastMessageRole: string;
  }> {
    const messages = await this.getChatHistory(userId, sessionId);
    const issues: string[] = [];
    const orphanedMessages: ChatMessage[] = [];
    
    // Check for alternating pattern violations
    for (let i = 0; i < messages.length - 1; i++) {
      const currentMessage = messages[i];
      const nextMessage = messages[i + 1];
      
      // Check if we have two consecutive messages of the same role
      if (currentMessage.role === nextMessage.role) {
        if (currentMessage.role === MessageRole.USER) {
          orphanedMessages.push(currentMessage);
          issues.push('Orphaned user message found at position ' + (i + 1) + ' (ID: ' + currentMessage.id + ')');
        } else {
          issues.push('Consecutive assistant messages found at positions ' + (i + 1) + ' and ' + (i + 2));
        }
      }
    }
    
    // Check if the last message is a user message without response
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === MessageRole.USER) {
      orphanedMessages.push(lastMessage);
      issues.push('Conversation ends with unresponded user message (ID: ' + lastMessage.id + ')');
    }
    
    // Check conversation summary consistency
    const messagesWithSummaries = messages.filter(msg => 
      msg.conversationSummary && 
      msg.conversationSummary !== 'No summary available'
    );
    
    const expectedSummaries = Math.floor(messages.length / 5);
    if (messagesWithSummaries.length !== expectedSummaries) {
      issues.push('Summary count mismatch: expected ' + expectedSummaries + ', found ' + messagesWithSummaries.length);
    }
    
    return {
      isHealthy: issues.length === 0,
      issues,
      orphanedMessages,
      totalMessages: messages.length,
      lastMessageRole: lastMessage?.role || 'none'
    };
  }

  /**
   * Attempts to recover from conversation integrity issues
   * This can be called manually or automatically when issues are detected
   */
  async recoverConversationIntegrity(sessionId: string, userId: string): Promise<{
    success: boolean;
    actionsPerformed: string[];
    remainingIssues: string[];
  }> {
    const integrityCheck = await this.checkConversationIntegrity(sessionId, userId);
    const actionsPerformed: string[] = [];
    
    if (integrityCheck.isHealthy) {
      return {
        success: true,
        actionsPerformed: ['No recovery needed - conversation is healthy'],
        remainingIssues: []
      };
    }
    
    // Handle orphaned user messages by generating responses
    for (const orphanedMessage of integrityCheck.orphanedMessages) {
      try {
        console.log('Attempting to recover orphaned message: ' + orphanedMessage.id);
        
        // Get context at the time of the orphaned message
        const messagesUpToOrphan = await this.chatMessageRepository.find({
          where: { 
            session_id: sessionId,
            created_at: { $lte: orphanedMessage.created_at } as any
          },
          order: { created_at: 'ASC' }
        });
        
        // Generate a recovery response
        const recoveryContext = orphanedMessage.extractedContents?.map(ctx => 
          'File name: ' + ctx.fileName + ' Content: ' + ctx.text + ' File Id: ' + ctx.fileId
        ).join('\n') || 'No context available';
        
        const response = await this.aiService.generateChatResponse(
          messagesUpToOrphan.slice(-5), // Last 5 messages for context
        );
        
        // Create the recovery AI message
        const recoveryMessage = this.chatMessageRepository.create({
          role: MessageRole.ASSISTANT,
          content: response + '\n\n*[This response was automatically generated during conversation recovery.]*',
          extractedContents: orphanedMessage.extractedContents || [],
          conversationSummary: 'Recovery response',
          session_id: sessionId,
          session: orphanedMessage.session,
          created_at: new Date(orphanedMessage.created_at.getTime() + 1000) // 1 second after orphaned message
        });
        
        await this.chatMessageRepository.save(recoveryMessage);
        actionsPerformed.push('Generated recovery response for orphaned message ' + orphanedMessage.id);
        
      } catch (error) {
        console.error('Failed to recover orphaned message ' + orphanedMessage.id + ':', error);
        actionsPerformed.push('Failed to recover orphaned message ' + orphanedMessage.id + ': ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    }
    
    // Re-check integrity after recovery attempts
    const finalCheck = await this.checkConversationIntegrity(sessionId, userId);
    
    return {
      success: finalCheck.isHealthy,
      actionsPerformed,
      remainingIssues: finalCheck.issues
    };
  }
}
