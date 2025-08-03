import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pinecone, SearchRecordsResponseResult } from "@pinecone-database/pinecone";
import { join } from 'path';
import { ChatMessage, MessageRole } from "src/entities";
import OpenAI from "openai";
import { ResponseInput } from "openai/resources/responses/responses";
import { ExtractedContent } from "src/entities/extracted-content.entity";
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod'
import { Type } from "@google/genai";
import { response } from "express";

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private gemini: any;
  private geminiModels: {
    pro: string,
    flash: string;
    flashLite: string;
  };
  private openaiClient: OpenAI;
  private wrapperPath: string;
  private _Type: any;
  private pc: Pinecone;

  constructor(
    private configService: ConfigService,
  ) {
    this.geminiModels = {
      pro: 'gemini-2.5-pro',
      flash: 'gemini-2.5-flash',
      flashLite: 'gemini-2.5-flash-lite-preview-06-17',
    };
    // Calculate the path to our wrapper
    this.wrapperPath = join(
      process.cwd(),
      'dist',
      'modules',
      'ai',
      'gemini-wrapper.mjs',
    );
    this.pc = new Pinecone({
      apiKey: this.configService.get('PINECONE_API_KEY') as string,
    });
    
    // Validate OpenAI API key
    const openaiApiKey = this.configService.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      this.logger.error('OPENAI_API_KEY not found in environment variables');
      throw new Error('OPENAI_API_KEY not found in environment variables');
    }
    
    this.openaiClient = new OpenAI({
      apiKey: openaiApiKey,
    });
  }

  async onModuleInit() {
    try {
      this.logger.log('Attempting to initialize Google Gemini AI');

      // Try to dynamically import the ES module
      const genAIModule = await import('@google/genai');
      this.logger.log('Successfully imported @google/genai module');

      const apiKey = this.configService.get('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not found in environment variables');
      }

      this.gemini = new genAIModule.GoogleGenAI({ apiKey });
      this._Type = genAIModule.Type;

      this.logger.log('Successfully initialized Google Gemini AI');
    } catch (error) {
      // If any error occurs during initialization, create a mock implementation
      // instead of crashing the application
      this.logger.error('Failed to initialize Google Gemini AI:', error);
      console.warn(
        'AI service will run in DISABLED mode - AI features will return empty results',
      );

      // Set up mock implementations to prevent crashes
      this.gemini = {
        models: {
          generateContent: async () => ({ text: '[]' }),
          generateContentStream: async function* () {
            yield {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'AI service is currently unavailable' }],
                  },
                },
              ],
            };
          },
        },
      };

      this._Type = {
        ARRAY: 'ARRAY',
        OBJECT: 'OBJECT',
        STRING: 'STRING',
      };

      // Don't throw error, allow app to continue running with disabled AI
    }
  }

  async generateChatResponse(
    messages: ChatMessage[],
  ): Promise<string> {
    try {
      const systemPrompt = this.buildSystemPrompt();

      // Format conversation summaries if available
      let conversationSummaryText = '';
      
      // Find all messages that have conversation summaries (regardless of position)
      const messagesWithSummaries = messages.filter(msg => 
        msg.conversationSummary && 
        msg.conversationSummary !== 'No summary available' &&
        msg.conversationSummary.trim() !== ''
      );
      
      if (messagesWithSummaries.length > 0) {
        const conversationSummaries: string[] = [];
        
        // Sort by creation date to maintain chronological order
        const sortedSummaryMessages = messagesWithSummaries.sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        
        sortedSummaryMessages.forEach((msg, index) => {
          // Calculate the approximate message range this summary covers
          // Each summary covers roughly 5 messages, but we don't assume exact positions
          const summaryNumber = index + 1;
          const estimatedStart = summaryNumber * 5 - 4;
          const estimatedEnd = summaryNumber * 5;
          
          conversationSummaries.push(
            `Summary ${summaryNumber} (approximately messages ${estimatedStart}-${estimatedEnd}): ${msg.conversationSummary}`
          );
        });

        // Add conversation summaries to system prompt if we have any
        conversationSummaryText = `\n\nConversation History Summaries:\n\n${conversationSummaries.join('\n\n')}`;
      }

      // Format input for Responses API - can be a simple string or array of message objects
      const inputContent: ResponseInput = messages.map((msg) => {
        const messageExtractedContentStr = `Files:\n${msg.extractedContents.map(e => `File Id: ${e.fileId}\nFile Name: ${e.fileName}\nText: ${e.text}`)}`
        return {
          role: msg.role === MessageRole.USER ? MessageRole.USER : MessageRole.ASSISTANT,
          content: `Context: ${messageExtractedContentStr}\n\nUser query: ${msg.content}`,
        };
      });

      inputContent.unshift({
        role: MessageRole.DEVELOPER,
        content: conversationSummaryText,
      });

      this.logger.debug(
        `Calling OpenAI Responses API with ${messages.length} messages`,
      );

      const response = await this.openaiClient.responses.create({
        model: "gpt-4.1-mini",
        instructions: systemPrompt,
        input: inputContent,
        stream: false,
        temperature: 0.2,
      });

      return response.output_text;
    } catch (error: unknown) {
      this.logger.error('Error in generateChatResponse:', error);
      
      // Provide more specific error messages for common issues
      if (error instanceof Error) {
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          this.logger.error('OpenAI API authentication failed - check your OPENAI_API_KEY');
          return 'Authentication failed with OpenAI API. Please check your API key configuration.';
        }
        if (error.message.includes('quota') || error.message.includes('billing')) {
          this.logger.error('OpenAI API quota or billing issue');
          return 'OpenAI API quota exceeded or billing issue. Please check your OpenAI account.';
        }
      }
      
      return 'Sorry, I encountered an error while processing your request.';
    }
  }

  async* generateChatResponseStream(
    messages: ChatMessage[],
  ): AsyncGenerator<string, void, unknown> {
    try {
      const systemPrompt = this.buildSystemPrompt();

      // Format conversation summaries if available
      let conversationSummaryText = '';
      
      // Find all messages that have conversation summaries (regardless of position)
      const messagesWithSummaries = messages.filter(msg => 
        msg.conversationSummary && 
        msg.conversationSummary !== 'No summary available' &&
        msg.conversationSummary.trim() !== ''
      );
      
      if (messagesWithSummaries.length > 0) {
        const conversationSummaries: string[] = [];
        
        // Sort by creation date to maintain chronological order
        const sortedSummaryMessages = messagesWithSummaries.sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        
        sortedSummaryMessages.forEach((msg, index) => {
          // Calculate the approximate message range this summary covers
          // Each summary covers roughly 5 messages, but we don't assume exact positions
          const summaryNumber = index + 1;
          const estimatedStart = summaryNumber * 5 - 4;
          const estimatedEnd = summaryNumber * 5;
          
          conversationSummaries.push(
            `Summary ${summaryNumber} (approximately messages ${estimatedStart}-${estimatedEnd}): ${msg.conversationSummary || 'No summary available'}`
          );
        });

        // Add conversation summaries to system prompt if we have any
        conversationSummaryText = `\n\nConversation History Summaries:\n\n${conversationSummaries.join('\n\n')}`;
      }

      // Format input for Responses API - can be a simple string or array of message objects
      const inputContent = messages.map((msg) => {
        const messageExtractedContentStr = `\n\n${msg.extractedContents.map(e => `File Id: ${e.fileId}\nFile Name: ${e.fileName}\nText: ${e.text}\n\n`).join('')}`
        return {
          role: msg.role === MessageRole.USER ? MessageRole.USER : MessageRole.MODEL,
          parts: [{
            text: `Context: ${messageExtractedContentStr}\n\nUser query: ${msg.content}`,
          }],
        };
      });

      if (messagesWithSummaries.length > 0) {
        inputContent.unshift({
          role: MessageRole.USER,
          parts: [{
            text: conversationSummaryText,
          }],
        });
      }

      this.logger.debug(
        `Calling OpenAI Responses API with ${messages.length} messages (streaming)`,
      );

      const response = await this.gemini.models.generateContentStream({
        model: this.geminiModels.flash,
        config: {
          systemInstruction: systemPrompt,
        },
        contents: inputContent,
        temperature: 0.2,
      });

      for await (const chunk of response) {
        yield chunk.text
      }
    } catch (error: unknown) {
      this.logger.error('Error in generateChatResponse:', error);
      
      // Provide more specific error messages for common issues
      if (error instanceof Error) {
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          this.logger.error('OpenAI API authentication failed - check your OPENAI_API_KEY');
        }
        if (error.message.includes('quota') || error.message.includes('billing')) {
          this.logger.error('OpenAI API quota or billing issue');
        }
      }
    }
  }

  private buildSystemPrompt(): string {
    const prompt = `
      ROLE: Answer user queries using only provided context and message history.
      
      SOURCES:
      1. Context: Text portions with id, title, and content
      2. History Summaries: Previous conversation summaries
      
      RULES:
      - Use ONLY provided context, no external knowledge
      - Every statement MUST have a reference
      - If no relevant info found: "The requested information was not found in the file context. Please try again providing more context."
      - Match user's language but keep reference text in original language
      
      REFERENCE FORMAT (required for each statement):
      Statement text.
      [REF]
      {
        "id": "file-portion-id",
        "text": "exact text from source"
      }
      [/REF]
      
      Example:
      Mitochondria produce ATP through oxidative phosphorylation.
      [REF]
      {
        "id": "1003",
        "text": "Mitochondria serve as the primary energy generators in human cells by converting glucose into ATP through the process of oxidative phosphorylation."
      }
      [/REF]

      NOTE 1: Each reference should follow it's corresponding statement. Don't return all the references at the end.

      NOTE 2: The references' text should be exactly as you received it in the context. DO NOT add or remove any characters. Including characters like >, ≥, ≤, <, =, -, {, }, (, ), [, ], +, /, and ANY character that was in the original chunk text, including numbers as well.

      NOTE 3: NEVER combine the text of multiple references. If you need to provide multiple references, provide them in different opening and closing reference tags ([REF] and [/REF]).

      NOTE 4: It is EXTREMELY IMPORTANT that when providing references, you DON'T modify the text of the references. You must only provide the references' text as they are in the file content.

      NOTE 5: When providing each reference, ALWAYS open and close the reference tags ([REF] and [/REF]).
    `;

    return prompt;
  }

  async userQueryCategorizer(query: string): Promise<string> {
    try {
      // Optimization: Use OpenAI with structured output for better performance and consistency
      const categoryFormat = z.object({
        category: z.enum(['SPECIFIC', 'GENERIC']),
        confidence: z.union([z.number(), z.null()])
      });

      const response = await this.openaiClient.responses.parse({
        model: 'gpt-4.1-nano',
        input: query,
        instructions: `Categorize user query as SPECIFIC or GENERIC.
        
        SPECIFIC: Asks for particular facts, details, or targeted information about specific topics
        Examples: "How does X work?", "What is Y?", "Mechanisms of Z", "Role of A in B"
        
        GENERIC: Requests summaries, overviews, or general document information
        Examples: "Main points?", "Summarize file", "What's this about?", "Hypothesis?"
        
        OUTPUT: JSON with category (SPECIFIC/GENERIC)`,
        stream: false,
        temperature: 0.1,
        text: {
          format: zodTextFormat(categoryFormat, "category")
        }
      });

      return response.output_parsed?.category || 'GENERIC';
    } catch (error) {
      console.error('Error categorizing user query:', error);
      return 'GENERIC';
    }
  }

  async semanticSearch(
    query: string,
    userId: string,
    fileId?: string,
  ): Promise<{
    hits: SearchRecordsResponseResult['hits'],
    question: string,
  }> {
    const index = this.pc.index(
      this.configService.get('PINECONE_INDEX_NAME') as string,
      this.configService.get('PINECONE_INDEX_HOST') as string,
    );
    const namespace = index.namespace(userId);
    const describedNamespace = await namespace.describeNamespace(userId);
    const recordCount = describedNamespace.recordCount;
    const recordCountNumber = Number(recordCount);
    const isRecordCountNumber = !isNaN(recordCountNumber);
    const topK = isRecordCountNumber
      ? recordCountNumber < 3
        ? recordCountNumber
        : 3
      : 3;
    const topN = isRecordCountNumber
      ? topK < 5
        ? Math.floor(topK - topK * 0.2)
        : 5
      : 5;
    const lessThan250Words = this.countWords(query) < 250;

    const response = await namespace.searchRecords({
      query: {
        topK: topK,
        inputs: { text: query },
        filter: {
          userId: userId,
          ...(fileId && { fileId: fileId }),
        }
      },
      fields: ['chunk_text', 'fileId', 'name', 'userId'],
      /*...(lessThan250Words
        ? {
            rerank: {
              model: 'bge-reranker-v2-m3',
              rankFields: ['chunk_text'],
              topN: topN,
            },
          }
        : {}),*/
    });

    return {
      hits: response.result.hits,
      question: query,
    };
  }

  countWords(text: string): number {
    return text.split(/\s+/).filter((word) => word.length > 0).length;
  }

  async generateSessionName(firstMessage: string): Promise<string> {
    try {
      // Prepare the prompt for generating a session name
      const prompt = `
        Create a short, concise title (maximum 30 characters) for a chat conversation that starts with this message:
        "${firstMessage}"
        
        Return ONLY the title text, nothing else.
      `;

      const result = await this.gemini.models.generateContent({
        model: this.geminiModels.flashLite,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a session name generator. Generate a short, concise title (maximum 30 characters) for a chat conversation that starts with the message you receive. Return ONLY the title text, nothing else.',
          temperature: 0.2,
        },
      });
      const name = result.text;

      // Limit the length and remove any quotes
      return name?.substring(0, 30)
        ? name?.substring(0, 30)
        : `Chat ${new Date().toLocaleDateString()}`;
    } catch (error) {
      console.error('Error generating session name:', error);
      return `Chat ${new Date().toLocaleDateString()}`;
    }
  }

  async generateSummary(fileContent: string | null): Promise<string> {
    try {
      // Prepare the prompt for generating a summary
      const prompt = `${fileContent}`;

      const result = await this.gemini.models.generateContent({
        model: this.geminiModels.flashLite,
        contents: prompt,
        config: {
          systemInstruction:
            `You are a summary generator. You will receive the extracted text from a file.Generate a concise summary of that text. Return ONLY the summary text, nothing else. The summary should be around 10% to 25% long of the original text, but if the original text is too short, don't make the summary shorter than 1000 words. The percentage should be a reasonable percentage, so that the summary conveys the main points effectively. The summary will then be passed to another AI model, alongside with a general user query, to generate specific questions based on it, that will then be used to make requests to a vector store. So if you can tailor the summary for that purpose, it would be great.
            
            Note: Ignore the [START_PAGE] and [END_PAGE] markers, they are not part of the text that you should summarize. They are just used to indicate the start and end of a page in the original file.`,
          temperature: 0.2,
        },
      });
      const summary = result.text;

      // Limit the length and remove any quotes
      return summary ? summary : `The file has no summary`;
    } catch (error) {
      console.error('Error generating summary:', error);
      return `The file has no summary`;
    }
  }

  async generateFileName(content: string | null): Promise<string> {
    try {
      // Prepare the prompt for generating a session name
      const prompt = `
        Extract the title from the following text that was extracted from a file:
        "${content}"
        
        Return ONLY the title text, nothing else.
      `;

      const result = await this.gemini.models.generateContent({
        model: this.geminiModels.flashLite,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a file title extractor. Extract the title from the text that you receive, that was originally extracted from a file. Return ONLY the title text, nothing else. You will receive 1/4 of the text of the file, so you must focus on detecting the title of the original file from only that portion of the text that you receive.',
          temperature: 0.2,
        },
      });
      const name = result.text;

      // Limit the length and remove any quotes
      return name;
    } catch (error) {
      console.error('Error generating file name:', error);
      return `File ${new Date().toLocaleDateString()}`;
    }
  }

  async loadReferenceAgain(textToSearch: string, context: ExtractedContent[]): Promise<string> {
    try {
      const response = await this.gemini.models.generateContent({
        model: this.geminiModels.pro,
        contents: `Specific text to search for: "${textToSearch}"

        Files context: ${JSON.stringify(context)}`,
        config: {
          systemInstruction: `You have to do the following tasks in this exact order: 

1. Search for a specific text inside the Files context, that is a set of text snippets from one or more files that are distributed in an unorderly way. The text you are searching for might not be an exact match to what is in the Files context. It could have minor variations in wording, characters, punctuation, or spacing.

2. If you find the specific text, but it is split into two parts by other content (such as information that could have been extracted from a table, graph, or other unrelated text, or the [START_PAGE] and [END_PAGE] markers), you must identify both parts. After identifying both parts, you must return ONLY the longer of the two parts. Do not include the content that was in the middle.

3. If you find the specific text and it is not split, but contains minor variations (e.g., different punctuation, a few different words or characters), return it exactly as it appears in the Files context.

4. If you do not find the specific text in the Files context (neither whole, with minor variations, nor split), then you must return the specific text exactly as you received it.

5. If you find the specific text and it has an additional word or character next to it (either at the beginning or at the end), with no spaces between the specific text and the additional word or character, you must never split the two. Return the specific text and the additional word or character together, as it appears in the Files context. For example, if the specific text is "There were no significant differences between the two groups.", and the Files context has "methodsThis was a randomized controlled trial in which 137 participants were enrolled.", you must return "methodsThis was a randomized controlled trial in which 137 participants were enrolled.". Never return the specific text without the additional word or character, if it corresponds, even if the two don't make much sense together. If the additional word or character is part of a larger text or phrase, you must only return the specific text next to the additional word or character, and ignore the other part, even if it doesn't make sense. For example, if the specific text is "We conducted a randomized controlled trial in which 137 participants were enrolled.", and the Files context has "Materials and methodsThis was a randomized controlled trial in which 137 participants were enrolled.", you must return "methodsThis was a randomized controlled trial in which 137 participants were enrolled.". You must always return the specific text and the additional word or character together, when it corresponds, and nothing more.`,
          temperature: 0.2,
          maxOutputTokens: 8000,
          thinkingConfig: {
            thinkingBudget: 3000,
          },
        },
      });

      let result = response.text;

      const result2 = await this.filterReferencesNumericalRef(result);
      return result2 ? result2 : textToSearch; // Return the original text if no result found
    } catch (error) {
      console.error(
        `Error searching reference again: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw new InternalServerErrorException(
        `Error searching reference again: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  async filterReferencesNumericalRef(
    textToSearch: string,
  ): Promise<string> {
    try {
      const response = await this.gemini.models.generateContent({
        model: this.geminiModels.pro,
        contents: `${textToSearch}`,
        config: {
          systemInstruction: `You will receive a text (that is a response to a user query) that contains standard text, but also references to files that were used to generate that response in a specific format (each between the [REF] and [/REF] tags). Your task is to filter the text following the rule below:

          1. The text of each reference can be split by one or more consecutive or disperse numerical references (that could be in different formats, such as [1], [2], [3], or just 1, 2, 3, etc.), you must identify the parts of the text of the reference that are split by the numerical references. After identifying the parts, you must modify the text of the reference to ONLY contain the longest of the parts. Do not include all the parts. After selecting the longest part, remove the numerical reference from it, if it is still there. Take into account that the numerical references could be separated by a comma, a space, or enclosed in square brackets, so you must be careful to identify them correctly. Also take into account that the text of the reference can contain numers that ARE NOT numerical references, so you must be careful to only remove the numerical references that are part of the text of the reference, and not those that are not. To understand which are the numerical references and which are not, you must take into account the context of the text of the reference, and the fact that numerical references are usually used to refer to a specific piece of information, while numbers that are not numerical references are usually part of the text itself (for example, in a sentence like "The study was conducted in 2023", the number 2023 is not a numerical reference, but part of the text; or in a sentence like "There were 97 participants in the study", the number 97 is not a numerical reference, but part of the text.). You DO NOT have to remove the numerical references, you must only remove the shorter parts of the text of the reference that are split by the numerical references, and replace the text of the reference with the longest part.
          
          After filtering the text of the references that contain numerical references, you must return the modified text, with the references that were modified, and the rest of the text unchanged. If there are no numerical references in the text, you must return the text as it is.`,
          temperature: 0.2,
          maxOutputTokens: 8000,
          thinkingConfig: {
            thinkingBudget: 128,
          },
        },
      });

      let result = response.text;
      return result ? result : textToSearch; // Return the original text if no result found
    } catch (error) {
      console.error(
        `Error filtering numerical references: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw new InternalServerErrorException(
        `Error filtering numerical references: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async generateQuestionsFromFile(fileText: string): Promise<{ description: string; questions: string[] }> {
    try {
      // Optimization: More structured and concise prompt with clear output format
      const questionsFormat = z.object({
        description: z.string(),
        questions: z.array(z.string()),
      });
      const response = await this.openaiClient.responses.parse({
        model: 'gpt-4.1-mini',
        input: fileText.substring(0, 8000), // Limit input to reduce tokens
        instructions: `Generate comprehensive questions and description from document content.
        
        TASK 1: Create 8-12 diverse questions covering:
        - Main topics and key concepts
        - Specific details and facts
        - Relationships and implications
        - Practical applications
        
        TASK 2: Write concise description (2-3 sentences) summarizing:
        - Primary subject matter
        - Key themes or findings
        - Document purpose/scope
        
        OUTPUT: JSON with questions array and description string`,
        stream: false,
        temperature: 0.2,
        text: {
          format: zodTextFormat(questionsFormat, "content")
        }
      });

      return response.output_parsed ? response.output_parsed : { description: '', questions: [] }; // Return an empty array if no result found
    } catch (error) {
      console.error(
        `Error generating questions from query: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw new InternalServerErrorException(
        `Error generating questions from query: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // Optimization: Streaming version for progressive response
  async* generateQuestionsFromFileStream(
    fileText: string,
  ): AsyncGenerator<{ description: string; questions: string[]; isComplete: boolean }> {
    const questionsFormat = z.object({
      description: z.string(),
      questions: z.array(z.string()),
    });

    try {
      const response = await this.openaiClient.responses.parse({
        model: 'gpt-4.1-mini',
        input: fileText.substring(0, 8000),
        instructions: `Generate comprehensive questions and description from document content.
        
        TASK 1: Create 8-12 diverse questions covering:
        - Main topics and key concepts
        - Specific details and facts
        - Relationships and implications
        - Practical applications
        
        TASK 2: Write concise description (2-3 sentences) summarizing:
        - Primary subject matter
        - Key themes or findings
        - Document purpose/scope
        
        OUTPUT: JSON with questions array and description string`,
        stream: true,
        temperature: 0.2,
        text: {
          format: zodTextFormat(questionsFormat, "content")
        }
      });

      // Yield intermediate progress
      yield { description: 'Processing...', questions: [], isComplete: false };
      
      const result = response.output_parsed || { description: '', questions: [] };
      yield { ...result, isComplete: true };
      
    } catch (error) {
      console.error('Error in generateQuestionsFromFileStream:', error);
      yield { description: '', questions: [], isComplete: true };
    }
  }

  async generateConversationSummary(messages: ChatMessage[]): Promise<string | null> {
    if (messages.length === 0) return null;

    const response = await this.gemini.models.generateContent({
      model: this.geminiModels.flash,
      contents: ``,
      config: {
        systemInstruction: ``,
        temperature: 0.2,
        maxOutputTokens: 8000,
      },
    });

    let result = response.text;

    return result ? result : null; // Return null if no result found
  }

  async filterSearchResults(
    searchResults: any[],
    question: string,
    userQuery: string,
  ): Promise<{ fileId: string; name: string; text: string }> {
    // Optimization: Simplified input format and more concise instructions
    const searchData = searchResults.map(r => ({
      id: r.fields.fileId,
      name: r.fields.name,
      chunk: r.fields.chunk_text
    }));

    const searchDataStr = `${searchData.map(sd => `Chunk:\nFileId: ${sd.id}\nName: ${sd.name}\nText: ${sd.chunk}`).join('\n\n')}`

    /*const responseFormat = z.object({
      fileId: z.string(),
      name: z.string(),
      text: z.string(),
    });*/

    const result = await this.gemini.models.generateContent({
      model: this.geminiModels.flashLite,
      config: {
        systemInstruction: `Filter text chunks to extract the shortest text snippet possible that answers the user query (no longer than one sentence).
        
        TASK: Find the most relevant text snippet
        - Extract the single most relevant text snippet that directly answers the query from the chunks that you receive (no longer than one sentence).
        - If the text you want to return starts in one chunk and ends in another, return the part from the first chunk followed by the part from the second chunk, as if it is a single, continuous text. For this case, the chunks will have overlap, so you will have to take the text snippet from the first chunk and add the corresponding text snippet from the second chunk to continue the statement, without duplicating the overlap.
        - DO NOT add or remove any characters from the text snippet you are returning, compared to the text in the chunks. Including characters like >, ≥, ≤, <, =, -, {, }, (, ), [, ], +, /, and ANY character that was in the original chunk text, including numbers as well.

        - Return empty strings if no relevant content found
      
        INPUT: Query + array of {id, name, text} objects
        OUTPUT: JSON with fileId, name, and the extracted text snippet
      
        NOTE 1: If the text is split by information that was extracted from tables or graphs, provide only the longest coherent part of the two.
      
        NOTE 2: It is EXTREMELY IMPORTANT that you don't make any modifications in the text snippet you are returning, compare it to the original text and make sure it is exactly the same.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            fileId: {
              type: Type.STRING,
            },
            name: {
              type: Type.STRING,
            },
            text: {
              type: Type.STRING,
            }
          }
        }
      },
      contents: `Query: ${question}\n\nChunks: \n${searchDataStr}`,
      temperature: 0.2,
    })

    const parsedResult = JSON.parse(result.text);

    const result2 = await this.gemini.models.generateContent({
      model: this.geminiModels.flashLite,
      config: {
        systemInstruction: `Filter the text following these guidelines:
        
        1. If the text is split across pages (contains [START_PAGE] and [END_PAGE] markers in the middle), provide only the longest part of the two. Remove the page markers but DO NOT add ellipses (...).

        2. If the text has numerical references like [1], [2], [3] or 1, 2, 3, provide only the longest part of the text between these references. These numerical references are detectable by seeing if the numbers present have coherence with the text in which they are in. If they are random numbers inserted that don't have coherence with the text, it is because they are numerical references. If, the numbers have meaning with respect to the rest of the text, return the whole text.


        NOTE 1: It is EXTREMELY IMPORTANT that you don't make any modifications in the text snippet you are returning. After you have filtered with the above guidelines, compare the filtered text to the original text and make sure it doesn't contain any modifications.

        NOTE 2: DO NOT add or remove any characters from the text snippet you are returning, compared to the text in the chunks. Including characters like >, ≥, ≤, <, =, -, {, }, (, ), [, ], +, /, and ANY character that was in the original chunk text.
        `,
      },
      contents: parsedResult.text || '',
      temperature: 0.2,
      },
    )

    const response = {
      fileId: parsedResult.fileId || '',
      name: parsedResult.name || '',
      text: result2.text || '',
    }

    return response || { fileId: '', name: '', text: '' };
  }

  async determineIfQuestionsAnswerQuery(
    questions: string[],
    userQuery: string,
    description: string,
  ): Promise<string[]> {
    // Optimization: Structured output with relevance scoring
    const questionAnalysisFormat = z.object({
      relevantQuestions: z.array(z.string()),
      reasoning: z.union([z.string(), z.null()])
    });

    const response = await this.openaiClient.responses.parse({
      model: 'gpt-4.1-nano',
      input: `Query: ${userQuery}\n\nDescription: ${description}\n\nQuestions: ${questions.join('\n')}`,
      instructions: `Identify questions that help answer the user query.
      
      TASK: Select relevant questions from the provided list
      - Analyze each question against the user query and file description
      - Include only questions that directly contribute to answering the query
      - Return empty array if no questions are relevant
      
      OUTPUT: JSON with array of relevant questions`,
      stream: false,
      temperature: 0.1,
      text: {
        format: zodTextFormat(questionAnalysisFormat, "analysis")
      }
    });

    const result = response.output_parsed;
    return result?.relevantQuestions || [];
  }

  async generateQuestionsWithQuery(
    fileContent: string,
    userQuery: string,
  ): Promise<string[]> {
    const response = await this.openaiClient.responses.create({
      model: 'gpt-4.1-mini',
      input: `User query: ${userQuery}\n\nFile content: ${fileContent}`,
      instructions: `You will receive a text that is the text from a pdf file, and a generic user query. Your task is to generate a set of specific questions that can be asked about the text, based on the user query. The user query that you will receive is generic, but you must create specific questions that are relevant to the text and that, when responded, answer the user query. The questions should be concise and clear.
      `
    });

    let result = response.output_text;

    return result ? result.split('\n').filter(Boolean) : [];
  }

  // Optimization: Smart task decomposition - intelligently choose processing strategy
  async smartProcessingStrategy(
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; fileTextByPages?: string }>,
    userQuery: string,
    userId: string
  ): Promise<Array<{
    fileId: string;
    name: string;
    content: string;
    userId: string;
  }>> {
    try {
      // Smart decomposition: analyze query and file characteristics
      const queryComplexity = this.analyzeQueryComplexity(userQuery);
      const totalFiles = files.length;
      const avgQuestionsPerFile = files.reduce((sum, f) => sum + f.questions.length, 0) / totalFiles;
      
      // Choose optimal strategy based on analysis
      if (totalFiles <= 2 && queryComplexity === 'simple') {
        // Sequential processing for small, simple tasks
        return this.sequentialProcessFiles(files, userQuery, userId);
      } else if (totalFiles <= 5 && avgQuestionsPerFile <= 10) {
        // Parallel processing for medium tasks
        return this.batchProcessFiles(files, userQuery, userId);
      } else {
        // Hybrid approach for complex tasks
        return this.hybridProcessFiles(files, userQuery, userId);
      }
    } catch (error) {
      console.error('Error in smartProcessingStrategy:', error);
      return this.batchProcessFiles(files, userQuery, userId); // Fallback
    }
  }

  // COST OPTIMIZATION: Uses questions for semantic search to handle generic queries effectively
  private async costEfficientSemanticSearch(
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; fileTextByPages?: string }>,
    userQuery: string,
    userId: string
  ): Promise<Array<{
    fileId: string;
    name: string;
    content: string;
    userId: string;
  }>> {
    try {
      const results: Array<{
        fileId: string;
        name: string;
        content: string;
        userId: string;
      }> = [];
      
      // Process each file using its questions for semantic search
      for (const file of files) {
        if (file.questions && file.questions.length > 0) {
          // Use existing questions for semantic search (handles generic queries better)
          const questionSearchPromises = file.questions.map(question => 
            this.semanticSearch(question, userId, file.fileId)
          );
          
          const questionSearchResults = await Promise.all(questionSearchPromises);
          
          // Filter out empty results and process
          const validResults = questionSearchResults.filter(results => results && results.hits.length > 0);
          
          if (validResults.length > 0) {
            // Process all valid search results for this file
            const filterPromises = validResults.map(searchResults => 
              this.filterSearchResults(searchResults.hits, searchResults.question, userQuery)
            );
            
            const filteredResults = await Promise.all(filterPromises);

            filteredResults.forEach(result => {
              results.push({
                fileId: file.fileId,
                name: file.name,
                content: result.text,
                userId: userId,
              });
            })
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error in costEfficientSemanticSearch:', error);
      // Fallback to regular batch processing
      return this.batchProcessFiles(files, userQuery, userId);
    }
  }

  private analyzeQueryComplexity(query: string): 'simple' | 'medium' | 'complex' {
    const words = query.split(' ').length;
    const hasComplexTerms = /\b(analyze|compare|contrast|evaluate|synthesize|relationship|correlation)\b/i.test(query);
    
    if (words <= 5 && !hasComplexTerms) return 'simple';
    if (words <= 15 && !hasComplexTerms) return 'medium';
    return 'complex';
  }

  private async sequentialProcessFiles(
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; fileTextByPages?: string }>,
    userQuery: string,
    userId: string
  ): Promise<Array<{
    fileId: string;
    name: string;
    content: string;
    userId: string;
  }>> {
    const results: Array<{
      fileId: string;
      name: string;
      content: string;
      userId: string;
    }> = [];

    for (const file of files) {
      const fileResults = await this.processQuestionsForQuery(
        file.questions,
        file.description,
        userQuery,
        userId,
        file.fileId,
        file.fileTextByPages
      );
      results.push(...fileResults);
    }

    return results;
  }

  private async hybridProcessFiles(
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; fileTextByPages?: string }>,
    userQuery: string,
    userId: string
  ): Promise<Array<{
    fileId: string;
    name: string;
    content: string;
    userId: string;
  }>> {
    // Hybrid: prioritize files with more relevant questions, process in optimized batches
    const prioritizedFiles = files.sort((a, b) => {
      const aRelevance = this.calculateFileRelevance(a.description, userQuery);
      const bRelevance = this.calculateFileRelevance(b.description, userQuery);
      return bRelevance - aRelevance;
    });

    // Process high-priority files first in smaller batches
    const highPriority = prioritizedFiles.slice(0, Math.ceil(files.length / 2));
    const lowPriority = prioritizedFiles.slice(Math.ceil(files.length / 2));

    const highPriorityResults = await this.batchProcessFiles(highPriority, userQuery, userId);
    const lowPriorityResults = await this.batchProcessFiles(lowPriority, userQuery, userId);

    return [...highPriorityResults, ...lowPriorityResults];
  }

  private calculateFileRelevance(description: string, query: string): number {
    const queryWords = query.toLowerCase().split(' ');
    const descWords = description.toLowerCase().split(' ');
    const matches = queryWords.filter(word => descWords.includes(word)).length;
    return matches / queryWords.length;
  }

  // Optimization: Batch processing for multiple files
  async batchProcessFiles(
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; fileTextByPages?: string }>,
    userQuery: string,
    userId: string
  ): Promise<Array<{
    fileId: string;
    name: string;
    content: string;
    userId: string;
  }>> {
    try {
      // Process files in parallel with controlled concurrency
      const batchSize = 3; // Limit concurrent processing to avoid rate limits
      const results: Array<{
        fileId: string;
        name: string;
        content: string;
        userId: string;
      }> = [];

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const batchPromises = batch.map(file => 
          this.processQuestionsForQuery(
            file.questions,
            file.description,
            userQuery,
            userId,
            file.fileId,
            file.fileTextByPages
          )
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.flat());
      }

      return results;
    } catch (error) {
      console.error('Error in batchProcessFiles:', error);
      return [];
    }
  }

  // Process questions for query - uses questions for semantic search to handle generic queries
  async processQuestionsForQuery(
    questions: string[],
    description: string,
    userQuery: string,
    userId: string,
    fileId: string,
    fileTextByPages?: string
  ): Promise<Array<{
    fileId: string;
    name: string;
    content: string;
    userId: string;
  }>> {
    try {
      // Use full file content for question analysis to ensure high-quality questions
      let relevantContent = '';
      
      if (fileTextByPages) {
        // Full content is essential for generating comprehensive, relevant questions
        relevantContent = fileTextByPages;
      }

      // Prompt chaining - combine question analysis and generation
      const combinedResponseFormat = z.object({
        relevantQuestions: z.array(z.string()),
        needsNewQuestions: z.boolean(),
        newQuestions: z.array(z.string()),
        reasoning: z.string()
      });

      const response = await this.openaiClient.responses.parse({
        model: 'gpt-4.1-mini',
        input: `User query: ${userQuery}\n\nFile description: ${description}\n\nExisting questions: ${questions.join('\n')}${relevantContent ? `\n\nRelevant file content: ${relevantContent}` : ''}`,
        instructions: `You are an intelligent question processor. Analyze the user query against existing questions and file content to determine the best approach.

        TASK 1: Determine which existing questions help answer the user query
        - Review each existing question against the user query and file description
        - Select only questions that are directly relevant to answering the user query
        
        TASK 2: Determine if new questions are needed
        - If the existing relevant questions are sufficient to answer the user query, set needsNewQuestions to false
        - If the existing questions are insufficient or irrelevant, set needsNewQuestions to true
        
        TASK 3: Generate new questions if needed
        - If needsNewQuestions is true, generate 3-5 specific questions based on the file content that would help answer the user query
        - If needsNewQuestions is false, set newQuestions to an empty array
        - Make questions concise, specific, and directly relevant to the user query
        
        Return your analysis in the specified JSON format with:
        - relevantQuestions: array of existing questions that help answer the user query
        - needsNewQuestions: boolean indicating if new questions should be generated
        - newQuestions: array of new questions (empty array if needsNewQuestions is false)
        - reasoning: brief explanation of your decision`,
        stream: false,
        temperature: 0.2,
        text: {
          format: zodTextFormat(combinedResponseFormat, "event")
        }
      });

      const analysis = response.output_parsed;
      if (!analysis) {
        return [];
      }

      // Determine which questions to use
      let questionsToProcess: string[] = [];
      
      if (analysis.relevantQuestions.length > 0) {
        questionsToProcess = analysis.relevantQuestions;
      } else if (analysis.needsNewQuestions && analysis.newQuestions) {
        questionsToProcess = analysis.newQuestions;
      } else {
        // Fallback: if no questions are relevant and we can't generate new ones
        return [];
      }

      // Optimization 3: Parallel processing of semantic searches and filtering
      const searchPromises = questionsToProcess.map(question => 
        this.semanticSearch(question, userId, fileId)
      );
      
      const allSearchResults = await Promise.all(searchPromises);
      
      // Filter out empty search results and process in parallel
      const validSearchResults = allSearchResults.filter(results => results && results.hits.length > 0);
      
      if (validSearchResults.length === 0) {
        return [];
      }
      
      // Batch filter operations in parallel
      const filterPromises = validSearchResults.map(searchResults => 
        this.filterSearchResults(searchResults.hits, searchResults.question, userQuery)
      );
      
      const filteredResults = await Promise.all(filterPromises);
      
      // Transform to expected format
      return filteredResults.map(({ fileId, name, text }) => ({
        fileId,
        name,
        content: text,
        userId
      }));
      
    } catch (error) {
      console.error('Error in processQuestionsForQuery:', error);
      return [];
    }
  }
}