import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pinecone, SearchRecordsResponseResult } from "@pinecone-database/pinecone";
import { format, join } from 'path';
import { ChatMessage, MessageRole } from "src/entities";
import OpenAI from "openai";
import { ResponseInput, EasyInputMessage } from "openai/resources/responses/responses";
import { ExtractedContent } from "src/entities/extracted-content.entity";
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod'
import { Type } from "@google/genai";
import { response } from "express";
import { RawExtractedContent } from "src/entities/raw-extracted-contents";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { text } from "stream/consumers";

export enum QueryType {
  SPECIFIC = 'SPECIFIC',
  BROAD = 'BROAD',
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
    @InjectRepository(RawExtractedContent)
    private rawExtractedContentsRepository: Repository<RawExtractedContent>,
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
    questions: string[]
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
      const inputContent: EasyInputMessage[] = messages.map((msg) => {
        const messageExtractedContentStr = `\n\n${msg.extractedContents.map(e => `File Id: ${e.fileId}\nFile Name: ${e.fileName}\nText: ${e.text}\n\n`).join('')}`
        return {
          role: msg.role === MessageRole.USER ? MessageRole.USER : MessageRole.ASSISTANT,
          content: `${msg.role === MessageRole.USER ? `Context: ${messageExtractedContentStr}` : ``}\n\n${msg.role === MessageRole.USER ? `User query: ${msg.content}` : `Model response: ${msg.content}`}`,
        };
      });

      if (messagesWithSummaries.length > 0) {
        inputContent.unshift({
          role: MessageRole.DEVELOPER,
          content: conversationSummaryText
        });
      }

      this.logger.debug(
        `Calling OpenAI Responses API with ${messages.length} messages (streaming)`,
      );

      const response = await this.openaiClient.responses.create({
        model: 'gpt-5-nano-2025-08-07',
        instructions: systemPrompt,
        input: inputContent,
        reasoning: {
          effort: 'medium'
        },
        stream: true,
      });

      for await (const event of response) {
        // Handle different types of stream events for OPENAI
        if (event.type === 'response.output_text.delta') {
          yield event.delta;
        } else if (event.type === 'response.output_text.done') {
          // Text completion event - could yield final text if needed
          continue;
        } else if (event.type === 'response.completed') {
          // Response completion event
          break;
        }
        // Handle other event types as needed

        // HANDLE GEMINI
        // yield event.text
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
      3. Questions: Used for semantic search retrieval
      
      RULES:
      - Prioritize the provided context over your general knowledge when responding to the user query.
      - Every statement MUST have a reference
      - Don't repeat the information that you provide in the references, in your statements
      - If no relevant info found, respond the following (translate it if the user talks to you in another language): "The requested information was not found in the file context. Please try again providing more context."
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

      NOTE 2: NEVER provide references longer than one sentence, the references' text must ALWAYS be one sentence long. If you need to provide multiple sentences, provide multiple references, each one in a different opening and closing reference tags ([REF] and [/REF]).

      NOTE 3: It is EXTREMELY IMPORTANT that when providing the text of the references, you NEVER add or remove any characters from it, of any type. You MUST select one sentence from the context provided, as stated in NOTE 3, but you should NEVER add or remove any characters from that sentence you have selected as text of the reference. The references' text should be exactly as you received it in the context. DO NOT add or remove any characters. Including characters like >, ≥, ≤, <, =, -, {, }, (, ), [, ], +, /, and ANY character that was in the original chunk text, including numbers as well.

      NOTE 4: When providing each reference, ALWAYS open and close the reference tags ([REF] and [/REF]).

      NOTE 5: When responding, provide markdown formatting elements to improve the readability of the response, organizing the response in sections. For example, headings, subheadings, font bold, italic, bullet points, and numbered lists. Use headings with #, ##, ###; bold with **; italic with *; bullet points with -; and numbered lists with 1., 2., 3., etc.

      NOTE 6: Don't provide the same reference multiple times, only once.

      NOTE 7: Respond with information relevant to the user query. On that note, you don't have to use all the information of the context provided to you.

      NOTE 8: NEVER repeat the exact same text from the references' text in the statements you provide.

      NOTE 9: NEVER ask the user to provide information. What you can do if you need more information or the information in the context provided to you is not enough is tell the user in the language he speaks to you "Try to rephrase your question in a more specific way, so I can provide you with more accurate information.".

      NOTE 10: NEVER ask the user further questions about how he would like your response. Just use the context provided and the user query to answer the question. For example, dont ask him "Do you prefer a section-by-section detailed analysis or a one long paragraph summary?".

      NOTE 11: When your response is suitable to be answered in sections (with their corresponding headings or subheadings), ALWAYS do it using markdown formatting elements.
    `;

    return prompt;
  }

  async userQueryCategorizer(query: string): Promise<{
    specific: string[],
    generic: string[],
  }> {
    try {
      console.log('Input query for categorization:', query);

      const schema = z.object({
        specific: z.array(z.string()),
        generic: z.array(z.string()),
      });

      const response = await this.openaiClient.responses.parse({
        model: 'gpt-5-nano-2025-08-07',
        input: query,
        text: {
          format: zodTextFormat(schema, "event"),
        },
        instructions: `
You are a query categorizer. Your task is to:

1. Take the EXACT user query as provided
2. If it contains multiple distinct questions, break it down into atomic sub-queries
3. Categorize each query/sub-query as "specific" or "generic"
4. DO NOT generate new questions - only work with what the user actually asked

CATEGORIZATION RULES:

SPECIFIC queries:
- Ask for precise facts, numbers, definitions, or single concepts
- Can be answered with 1-2 sentences from a document
- Work well with semantic search

GENERIC queries:
- Ask for summaries, overviews, or broad explanations
- Require synthesis of multiple concepts
- Need comprehensive responses

EXAMPLES:

EXAMPLE 1
Input: "What is the sample size and what were the main findings?"
Output:
{
  "specific": ["What is the sample size?"],
  "generic": ["What were the main findings?"]
}

EXAMPLE 2
Input: "How many participants were there?"
Output:
{
  "specific": ["How many participants were there?"],
  "generic": []
}

EXAMPLE 3
Input: "Summarize this document"
Output:
{
  "specific": [],
  "generic": ["Summarize this document"]
}

EXAMPLE 4
Input: "provide a detailed analysis of this file"
Output:
{
  "specific": [],
  "generic": ["provide a detailed analysis of this file"]
}

IMPORTANT:
- Always return valid JSON with both "specific" and "generic" arrays
- If unsure, categorize as "generic"
- Single queries should go in one category only`,
      reasoning: {
        effort: 'minimal'
      }
    });

      console.log('Raw response from model:', response.text);
      
      let parsedResponse;
      try {
        parsedResponse = response.output_parsed;
        console.log('Parsed response:', parsedResponse);
      } catch (parseError) {
        console.error('JSON parsing failed:', parseError.message);
        // Fallback: treat as generic query
        return {
          specific: [],
          generic: [query],
        };
      }

      // Validate response structure
      if (!parsedResponse.specific || !parsedResponse.generic) {
        console.warn('Invalid response structure, using fallback');
        return {
          specific: [],
          generic: [query], // Fallback: treat as generic if structure is invalid
        };
      }

      const specificLength = parsedResponse.specific.length;
      const genericLength = parsedResponse.generic.length;
      console.log(`Categorization result - Specific: ${specificLength}, Generic: ${genericLength}`);

      // If both arrays are empty, fallback to treating the original query as generic
      if (specificLength === 0 && genericLength === 0) {
        console.warn('Both arrays empty, using fallback categorization');
        return {
          specific: [],
          generic: [query],
        };
      }

      return parsedResponse;
    } catch (error) {
      console.error('Error categorizing user query:', error);
      console.error('Query that caused error:', query);
      // Fallback: treat as generic query
      return {
        specific: [],
        generic: [query],
      };
    }
  }

  async semanticSearch(
    query: string,
    userId: string,
    fileIds?: string[],
  ): Promise<{
    hits: SearchRecordsResponseResult['hits'],
    question: string,
  }> {
    const kValue = 2;
    const rerankingModel = 'bge-reranker-v2-m3';
    const rerankOptions = {
      topN: 2,
      rankFields: ['chunk_text'],
      returnDocuments: true,
      parameters: {
        truncate: 'END'
      }, 
    };
    const index = this.pc.index(
      this.configService.get('PINECONE_INDEX_NAME') as string,
      this.configService.get('PINECONE_INDEX_HOST') as string,
    );
    const namespace = index.namespace(userId);
    // const describedNamespace = await namespace.describeNamespace(userId);
    // const recordCount = describedNamespace.recordCount;
    // const recordCountNumber = Number(recordCount);
    // const isRecordCountNumber = !isNaN(recordCountNumber);
    // const topK = isRecordCountNumber
    //   ? recordCountNumber < 3
    //     ? recordCountNumber
    //     : 3
    //   : kValue;
    // const topN = isRecordCountNumber
    //   ? topK < 5
    //     ? Math.floor(topK - topK * 0.2)
    //     : 5
    //   : 5;
    // const lessThan250Words = this.countWords(query) < 250;

    const response = await namespace.searchRecords({
      query: {
        topK: kValue,
        inputs: { text: query },
        filter: {
          userId: userId,
          ...(fileIds && fileIds.length > 0 ? { fileId: { $in: fileIds } } : {}),
        },
      },
      fields: ['chunk_text', 'fileId', 'name', 'userId'],
      // rerank: {
      //   model: 'bge-reranker-v2-m3',
      //   rankFields: ['chunk_text'],
      //   topN: 1,
      // }
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

  async generateStructuredSummary(fileContent: string | null): Promise<string> {
    try {
      // Prepare the prompt for generating a summary
      const prompt = `${fileContent}`;

      const result = await this.openaiClient.responses.create({
        model: 'gpt-5-nano-2025-08-07',
        input: prompt,
        instructions:
          `You are an structured summary generator. You will receive the extracted text from a file. Generate a structured summary of that text. Return ONLY the structured summary text, nothing else. It should contain the main sections and secondary sections distributed in the order they appear in the file. Each section should have it's short description (make it concise).


          Example: Research study
          Structured summary:
          1. Introduction: [SUMMARY OF THE INTRODUCTION]
          2. Materials and Methods: [SUMMARY OF THE MATIERLAS AND METHODS SECTION]
          3. Results: [SUMMARY OF THE RESULTS SECTION]
          4. Discussion: [SUMMARY OF THE DISCUSSION SECTION]
          5. Conclusions: [SUMMARY OF THE CONCLUSIONS SECTION]

          In this example you can see only main sections, but if the file is substantially larger, provide the secondary sections inside the main sections as well.

          Remember keeping the descriptions short. They should be enough to convey the main point of the section. But must not be larger than around 75 words.
          
          Note: This structured summary will be used to later retrieve information from the file by generating questions, so it should be tailored for this purpose.`,
      });
      const summary = result.output_text;

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

  async loadReferenceAgain(textToSearch: string, context: RawExtractedContent[]): Promise<string> {
    try {
      const response = await this.openaiClient.responses.create({
        model: 'gpt-5-nano-2025-08-07',
        input: `Text snippet to search for: "${textToSearch}"

        Files context: \n${context.map((c) => c.text).join('\n')}`,
        instructions: `You have to do the following tasks in this exact order: 

1. Search for a text snippet inside the Files context, that is a set of text chunks from one or more files that are distributed in an unorderly way. The text you are searching for might not be an exact match to what is in the Files context. It could have minor variations in wording, characters, punctuation, or spacing.

2. If you find the text snippet, but it is split into two parts by other content (such as information that could have been extracted from a table or graph), you must identify both parts. After identifying both parts, you must return ONLY the longer of the two parts. Do not include the content that was in the middle.

3. If you find the text snippet and it is not split, but contains minor variations (e.g., different punctuation, different characters, letters, numbers, or special characters), return it exactly as it appears in the Files context. Even if the wording doesn't make sense, for example, joined words, extra characters or spaces, missing characters or spaces, return it exactly as it appears in the Files context, not in the text snippet.

4. If you do not find the text snippet in the Files context (neither whole, with minor variations, or split), then you must return the text snippet exactly as you received it.
`,
        reasoning: {
          effort: 'low'
        },
      });

      let result = response.output_text;

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
      const response = await this.openaiClient.responses.create({
        model: 'gpt-5-nano-2025-08-07',
        input: `${textToSearch}`,
        instructions: `You will receive a text. Your task is to filter the text following the rule below:

        - The text can be split by one or more consecutive or disperse numerical references (that could be in different formats, such as [1], [2], [3], or just 1, 2, 3, etc.), you must identify the parts of the text that are split by the numerical references. After identifying the parts, you must modify the text to ONLY contain the longest of the parts. Do not include all the parts. After selecting the longest part, remove the numerical references from it, if it still has them. Take into account that the numerical references could be separated by a comma, a space, or enclosed in square brackets, so you must be careful to identify them correctly. Also take into account that the text can contain numbers that ARE NOT numerical references, so you must be careful to only remove the numbers that are numerical references, and not those that are not. To understand which are the numerical references and which are not, you must take into account the context of the text, and the fact that numerical references are usually used to refer to a specific piece of information, so they don't have semantic continuity with the text they are in. While numbers that are not numerical references are usually part of the text itself, and they fit within the meaning of the text they are in. For example, in a sentence like "The study was conducted in 2023", the number 2023 is not a numerical reference, but part of the text; or in a sentence like "There were 97 participants in the study", the number 97 is not a numerical reference, but part of the text.
        
        After filtering the text, you must return the modified text. If there are no numerical references in the text, you must return the text as you received it.
        
        Aside from the numerical references, you MUST NOT modify anything from the text.`,
        reasoning: {
          effort: 'high'
        },
      });

      let result = response.output_text;
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
      model: this.geminiModels.flashLite,
      contents: `${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`,
      config: {
        systemInstruction: `You are a conversation summary generator. You will receive a conversation history. Generate a concise summary of that conversation. Return ONLY the summary text, nothing else. The summary should be around 10% to 15% long of the original conversation. You must include the user's intent that the user had in the messages provided of the conversation. This summary will then be passed to an AI so that it has context of what the user has asked and of what another AI has responded.`,
        temperature: 0.2,
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

    const responseFormat = z.object({
      fileId: z.string(),
      name: z.string(),
      text: z.string(),
    });

    const response = await this.openaiClient.responses.parse({
      model: 'gpt-5-nano-2025-08-07',
      instructions: `Filter text chunks to extract the shortest text snippet possible that answers the user query (no longer than one sentence).
        
      TASK: Find the most relevant text snippet
      - Extract the single most relevant text snippet that directly answers the query from the chunks from a file that you receive (no longer than one sentence).
      - DO NOT add or remove any characters from the text snippet you are returning, compared to the text in the chunks. Including characters like >, ≥, ≤, <, =, -, {, }, (, ), [, ], +, /, and ANY character that was in the original chunk text, including numbers as well.

      INPUT: Query + array of {id, name, text} objects
      OUTPUT: JSON with fileId, name, and the extracted text snippet
        
      EXAMPLE OUTPUT:
      {"fileId": "123", "name": "Example File", "text": "This is the extracted text snippet."}
      
      NOTE 1: If the text is split in two parts by information that was extracted from tables or graphs, provide only the longest coherent part of the two.
        
      NOTE 2: The extracted text snippet should be in the same language as the text chunks.
      
      NOTE 3: If the text doesn't contain any relevant information to answer the query, return empty strings for fileId, name, and text.`,

      input: `Query: ${question}\n\nChunks: \n${searchDataStr}`,
      text: {
        format: zodTextFormat(responseFormat, "filter_text")
      },
      reasoning: {
        effort: 'low'
      }
    })

    const parsedResult = response.output_parsed

    let response2
    if (parsedResult?.text) {
      response2 = await this.openaiClient.responses.create({
        model: 'gpt-5-nano-2025-08-07',
        instructions: `Filter the text following these guidelines:

        1. If the text has numerical references like [1], [2], [3] or 1, 2, 3, follow the following steps:
          I. Split the text by the numerical references. These numerical references are detectable by seeing if the numbers present have semantical coherence with the rest of the text in which they are in. If they are random numbers inserted that don't have semantical coherence with the rest of the text, it is because they are numerical references. If, the numbers fit semantically within the text they are in, return the whole text.
          II. Return only the longest part of the parts that were divided by these numerical references.
          III. If the text doesn't have numerical references, return the whole text.
          IV. Examples of texts with numerical references:
            a. The mitochondria is the power house of the cell 1.
            b. We drew the data from the records of the John Hopkins Hospital 3, 4, the participants were middle aged adult smokers 3.
            c. Paliperidone is a second generation antipsychotic 2, usually applied by injectionss.
            d. The mitochondria is the power house of the cell [1].
            e. We drew the data from the records of the John Hopkins Hospital [3], [4], the participants were middle aged adult smokers [3].
          V. Examples of texts without numerical references:
            a. There were 237 participants in the study, 120 of which were men, and 117 women.
            b. The participants in the experimental group received between 2 and 3 doses of the medication, same as the placebo group.
            c. The psychological test, comprised of 87 questions, evaluates different aspects of emotional intelligence.

        2. If the text contains the [START_PAGE] and [END_PAGE] markers in the middle, return the text with the markers, don't remove them.

        NOTE: DO NOT add or remove any characters from the text snippet you are returning, compared to the text in the chunks. Including characters like >, ≥, ≤, <, =, -, {, }, (, ), [, ], +, /, ", ', and ANY character that was in the original chunk text.
        `,
        input: parsedResult?.text || '',
        reasoning: {
          effort: 'low'
        },
      })
    }
    const result = {
      fileId: parsedResult ? parsedResult.fileId : '',
      name: parsedResult ? parsedResult.name : '',
      text: response2?.output_text || parsedResult?.text || '',
    }

    return result || { fileId: '', name: '', text: '' };
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
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; summary?: string }>,
    userQuery: string,
    userId: string,
    sessionId: string,
    previousModelResponse?: string,
    previousUserQuery?: string,
  ): Promise<{
    filteredResults: Array<{
      fileId: string;
      name: string;
      content: string;
      userId: string;
    }>;
    rawExtractedContent: RawExtractedContent[];
  }> {
    try {
      // Smart decomposition: analyze query and file characteristics
      const queryComplexity = this.analyzeQueryComplexity(userQuery);
      const totalFiles = files.length;
      const avgQuestionsPerFile = files.reduce((sum, f) => sum + f.questions.length, 0) / totalFiles;
      
      // Choose optimal strategy based on analysis
      if (totalFiles <= 2 && queryComplexity === 'simple') {
        // Sequential processing for small, simple tasks
        return this.sequentialProcessFiles(files, userQuery, userId, sessionId, previousUserQuery, previousModelResponse);
      } else if (totalFiles <= 5 && avgQuestionsPerFile <= 10) {
        // Parallel processing for medium tasks
        return this.batchProcessFiles(files, userQuery, userId, sessionId, previousUserQuery, previousModelResponse);

      } else {
        // Hybrid approach for complex tasks
        return this.hybridProcessFiles(files, userQuery, userId, sessionId, previousUserQuery, previousModelResponse);


      }
    } catch (error) {
      console.error('Error in smartProcessingStrategy:', error);
      return this.batchProcessFiles(files, userQuery, userId, sessionId, previousUserQuery, previousModelResponse); // Fallback
    }
  }

  // COST OPTIMIZATION: Uses questions for semantic search to handle generic queries effectively
  /*private async costEfficientSemanticSearch(
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; fileTextByPages?: string }>,
    userQuery: string,
    userId: string,
    sessionId: string,
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
            this.semanticSearch(question, userId, [file.fileId])
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
      return this.batchProcessFiles(files, userQuery, userId, sessionId);
    }
  }*/

  private analyzeQueryComplexity(query: string): 'simple' | 'medium' | 'complex' {
    const words = query.split(' ').length;
    const hasComplexTerms = /\b(analyze|compare|contrast|evaluate|synthesize|relationship|correlation)\b/i.test(query);
    
    if (words <= 5 && !hasComplexTerms) return 'simple';
    if (words <= 15 && !hasComplexTerms) return 'medium';
    return 'complex';
  }

  private async sequentialProcessFiles(
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; summary?: string }>,
    userQuery: string,
    userId: string,
    sessionId: string,
    previousUserQuery?: string,
    previousModelResponse?: string,
  ): Promise<{
    filteredResults: Array<{
      fileId: string;
      name: string;
      content: string;
      userId: string;
    }>;
    rawExtractedContent: RawExtractedContent[];
  }> {

    const results: Array<{
      fileId: string;
      name: string;
      content: string;
      userId: string;
    }> = [];

    const rawExtractedContent: RawExtractedContent[] = [];


    for (const file of files) {
      const fileResults = await this.processQuestionsForQuery(
        file.questions,
        file.description,
        userQuery,
        userId,
        file.fileId,
        sessionId,
        file.summary,
        previousUserQuery,
        previousModelResponse,
      );
      rawExtractedContent.push(...fileResults.rawExtractedContent);
      results.push(...fileResults.filteredResults);
    }

    return {
      filteredResults: results,
      rawExtractedContent: rawExtractedContent,
    };
  }

  private async hybridProcessFiles(
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; fileTextByPages?: string }>,
    userQuery: string,
    userId: string,
    sessionId: string,
    previousUserQuery?: string,
    previousModelResponse?: string,
  ): Promise<{
    filteredResults: Array<{
      fileId: string;
      name: string;
      content: string;
      userId: string;
    }>;
    rawExtractedContent: RawExtractedContent[];
  }> {
    // Hybrid: prioritize files with more relevant questions, process in optimized batches
    const prioritizedFiles = files.sort((a, b) => {
      const aRelevance = this.calculateFileRelevance(a.description, userQuery);
      const bRelevance = this.calculateFileRelevance(b.description, userQuery);
      return bRelevance - aRelevance;
    });

    // Process high-priority files first in smaller batches
    const highPriority = prioritizedFiles.slice(0, Math.ceil(files.length / 2));
    const lowPriority = prioritizedFiles.slice(Math.ceil(files.length / 2));

    const highPriorityResults = await this.batchProcessFiles(highPriority, userQuery, userId, sessionId, previousUserQuery, previousModelResponse);
    const lowPriorityResults = await this.batchProcessFiles(lowPriority, userQuery, userId, sessionId, previousUserQuery, previousModelResponse);

    return {
      filteredResults: [...highPriorityResults.filteredResults, ...lowPriorityResults.filteredResults],
      rawExtractedContent: [...highPriorityResults.rawExtractedContent, ...lowPriorityResults.rawExtractedContent],
    };
  }

  private calculateFileRelevance(description: string, query: string): number {
    const queryWords = query.toLowerCase().split(' ');
    const descWords = description.toLowerCase().split(' ');
    const matches = queryWords.filter(word => descWords.includes(word)).length;
    return matches / queryWords.length;
  }

  // Optimization: Batch processing for multiple files
  async batchProcessFiles(
    files: Array<{ fileId: string; name: string; questions: string[]; description: string; summary?: string }>,
    userQuery: string,
    userId: string,
    sessionId: string,
    previousUserQuery?: string,
    previousModelResponse?: string,
  ): Promise<{
    filteredResults: Array<{
      fileId: string;
      name: string;
      content: string;
      userId: string;
    }>;
    rawExtractedContent: RawExtractedContent[];
  }> {

    try {
      // Process files in parallel with controlled concurrency
      const batchSize = 3; // Limit concurrent processing to avoid rate limits
      const results: Array<{
        fileId: string;
        name: string;
        content: string;
        userId: string;
      }> = [];
      const rawExtractedContent: RawExtractedContent[] = [];

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const batchPromises = batch.map(file => 
          this.processQuestionsForQuery(
            file.questions,
            file.description,
            userQuery,
            userId,
            file.fileId,
            sessionId,
            file.summary,
            previousUserQuery,
            previousModelResponse,
          )
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.map(br => br.filteredResults).flat());
        rawExtractedContent.push(...batchResults.map(br => br.rawExtractedContent).flat());

      }

      return {
        filteredResults: results,
        rawExtractedContent: rawExtractedContent ,
      };
    } catch (error) {
      console.error('Error in batchProcessFiles:', error);
      return {
        filteredResults: [],
        rawExtractedContent: [],
      };
    }
  }

  // Process questions for query - uses questions for semantic search to handle generic queries
  async processQuestionsForQuery(
    questions: string[],
    description: string,
    userQuery: string,
    userId: string,
    fileId: string,
    sessionId: string,
    summary?: string,
    previousUserQuery?: string,
    previousModelResponse?: string,
  ): Promise<{
    filteredResults: Array<{
      fileId: string;
      name: string;
      content: string;
      userId: string;
    }>;
    rawExtractedContent: RawExtractedContent[];
  }> {
    try {
      // Use full file content for question analysis to ensure high-quality questions
      let relevantContent = '';
      
      if (summary) {
        // Full content is essential for generating comprehensive, relevant questions
        relevantContent = summary;
      }

      // Prompt chaining - combine question analysis and generation
      /*const combinedResponseFormat = z.object({
        relevantQuestions: z.array(z.string()),
        needsNewQuestions: z.boolean(),
        newQuestions: z.array(z.string()),
      });*/

      const response = await this.gemini.models.generateContent({
        model: this.geminiModels.flash,
        contents: `User query: ${userQuery}\n\nFile description: ${description}\n\nExisting questions: ${questions.join('\n')}${relevantContent ? `\n\nFile summary: ${relevantContent}` : ''}\n\nPrevious user query: ${previousUserQuery || 'No previous user query exists'}\n\nPrevious model response: ${previousModelResponse || 'No previous model response exists'}`,
        config:  {
          systemInstruction: `You are an intelligent question processor. Analyze the user query against existing questions and file summary to determine the best approach.
          
          TASK 1: Determine which existing questions help answer the user query
          - Review each existing question against the user query and file description
          - Select only questions that are directly relevant to answering the user query
          
          TASK 2: Determine if new questions are needed
          - If the existing relevant questions are sufficient to answer the user query, set needsNewQuestions to false
          - If the existing questions are insufficient or irrelevant, set needsNewQuestions to true
          - To determine if new questions are needed, make sure that the existing questions cover everything that the user query asks for. For this, consider that the questions should be as complete as possible, so that the user query can be answered fully.
          
          TASK 3: Generate new questions if needed
          - If needsNewQuestions is true, generate 1-8 specific questions based on the file summary and the user query that would help answer it
          - If needsNewQuestions is false, set newQuestions to an empty array
          - Make questions concise, specific, and directly relevant to the user query
          
          Return your analysis in the specified JSON format with:
          - relevantQuestions: array of existing questions that help answer the user query
          - needsNewQuestions: boolean indicating if new questions should be generated
          - newQuestions: array of new questions (empty array if needsNewQuestions is false)
          
          NOTE 1: If the user sends a query that asks for more information, generate new specific questions different from the existing ones that you receive, that further investigate the topic the user previously asked about, and further explore things that weren't responded in the previous model response. Deduce from the user query, the file summary, the file description, and the current questions, what new questions you can generate. Examples of this kind of user query: "Provide more information about this", "Tell me more about that", "What else does it say?", "Can you provide more details?", "What else does the file say?", "Provide more information about the file".

          NOTE 2: The questions should be in the same language as the file summary.
          `,
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              relevantQuestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING
                }
              },
              needsNewQuestions: { 
                type: Type.BOOLEAN
              },
              newQuestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING
                }
              },
            }
          }
        },
      });

      const analysis = JSON.parse(response.text);
      if (!analysis) {
        return {
          filteredResults: [],
          rawExtractedContent: [],
        };
      }

      // Determine which questions to use
      let questionsToProcess: string[] = [];
      
      if (analysis.relevantQuestions.length > 0) {
        questionsToProcess = analysis.relevantQuestions;
      } else if (analysis.needsNewQuestions && analysis.newQuestions) {
        questionsToProcess = analysis.newQuestions;
      } else {
        // Fallback: if no questions are relevant and we can't generate new ones
        return {
          filteredResults: [],
          rawExtractedContent: [],
        };
      }

      // Optimization 3: Parallel processing of semantic searches and filtering
      const searchPromises = questionsToProcess.map(question => 
        this.semanticSearch(question, userId, [fileId])
      );
      
      const allSearchResults = await Promise.all(searchPromises);
      
      // Filter out empty search results and process in parallel
      const validSearchResults = allSearchResults.filter(results => results && results.hits.length > 0);
      
      if (validSearchResults.length === 0) {
        return {
          filteredResults: [],
          rawExtractedContent: [],
        };
      }
      
      const rawExtractedContent = await this.rawExtractedContentsRepository.save(
        validSearchResults.flatMap(result => 
          result.hits.map(hit => ({
            text: (hit.fields as any).chunk_text,
            fileId: (hit.fields as any).fileId,
            fileName: (hit.fields as any).name,
            userId: userId,
            sessionId: sessionId,
          } as RawExtractedContent))
        )
      );

      // Batch filter operations in parallel
      const filterPromises = validSearchResults.map(searchResults => 
        this.filterSearchResults(searchResults.hits, searchResults.question, userQuery)
      );
      
      const filteredResults = await Promise.all(filterPromises);
      
      // Transform to expected format
      return {
        filteredResults: filteredResults.map(({ fileId, name, text }) => ({
          fileId,
          name,
          content: text,
          userId
        })),
        rawExtractedContent: rawExtractedContent,
    }
      
    } catch (error) {
      console.error('Error in processQuestionsForQuery:', error);
      return {
        filteredResults: [],
        rawExtractedContent: [],
      };
    }
  }

  async generateQuestionsFromQuery(query: string, messages: ChatMessage[], fileContents: {
    id: string,
    name: string,
    summary: string,
    originalName: string,
  }[]): Promise<string[]> {

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

    const questionsFormat = z.object({
      questions: z.array(z.string()),
    });

    const response = await this.openaiClient.responses.parse({
      model: 'gpt-5-nano-2025-08-07',
      input: `User query: ${query}\n\nMessages: ${messages.map(message => `${message.role}: ${message.content}`).join('\n')}\n\n${conversationSummaryText}\n\nFiles' structure summaries: ${fileContents.map(file => `${file.originalName}: ${file.summary}`).join('\n')}`,
      instructions: `Follow these tasks in order:
    
      1. Determine if the user query is very specific.
      
      2. If the user query is not very specific, use the conversation history and the files' structure summaries to generate very specific questions.
      
      3. If the user query is not very specific, leave it as it is.
      
      4. Return the questions in case you generated new ones, or the user query in case you didn't, in a specific output JSON format.

      These questions, when responded, should cover all the possible ways the user query can be answered, based on the structure of the files. For example, if the user asks for a summary of a research paper, you must generate very specific questions that, when answered, will help a later reader understand all the main sections of the file, like the different aspects of the methodology, results, limitations, recommendations, conclusions, etc. In other words, you should crumble the user query into smaller questions that can be answered with very specific responses, not with  broad responses, that precisely ask about specific things, not general ones.
      
      OUTPUT JSON FORMAT:
      {
        questions: [
          'Question 1',
          'Question 2',
          'Question 3',
          ...
        ]
      }

      EXAMPLES:
      1. User query: "what were the methodologies used in the study?"
      Output: 
      {
        "questions": [
          "what tests were used in the study?",
          "what tests did they use for measuring [VARIABLE STUDIED]?",
          "what was the sample size?",
          "what was the research design?",
          "what was the research methodology?",
          "what was the research question?",
        ]
      }
      2. User query: "provide a detailed summary of the file"
      Output: 
      {
        "questions": [
          "What is the main research question or objective of this study?",
          "What is the methodology used in this research?",
          "What is the sample size and population characteristics?",
          "What statistical tests and analyses were performed?",
          "What were the key findings and results?",
          "What are the main conclusions drawn from the results?",
          "What limitations were identified in the study?",
          "What theoretical framework or models were used?",
          "What variables were measured and how?",
          "What instruments or tools were used for data collection?",
          "How was data validity and reliability ensured?",
          "What ethical considerations were addressed?",
          "What were the inclusion and exclusion criteria?",
          "What previous research or literature was cited as foundation?",
          "What recommendations were made for future research?"
        ]
      }

      As you can see from the examples, the questions should be as specific as possible, not asking broad questions like "provide a summary of the document", "what are the key points of the document?", "what was the methodology of the study?", "what are the main takeaways of the file?".
        
      NOTE 1: Use your knowledge base to understand what questions can be generated from the user query. For example, if the user query is "what tests were used in the study?", you know that there are usually multiple types of tests used in a study: statistical, psychological, medical, etc. You should generate questions to retrieve information of all those types of tests from the vector store. In other words, you should generate the questions to cover everything that can be associated with the user query, based on the structure of the files. If the user asks for a summary, the key points, a detailed summary, or anything that should cover the whole files, yous should generate questions that cover ALL the main sections of the files.
      
      NOTE 2: Make the questions as atomic as possible. For example, if the user query is "what tests were used in the study?", you should generate questions like "what statistical tests were used in the study?", "what tests did they use for measuring [VARIABLE STUDIED]?", "what was the sample size?", etc.
      
      NOTE 3: The questions should be in the same language as the user query.
      
      NOTE 4: Don't include the name of the files in the questions.
      
      NOTE 5: Only one thing should be asked with each question, not multiple things. For example, 'What are the main results, conclusions, or recommendations provided?' this question should be divided in "What are the main results?", "What did the authors recommend?", "What were the main conclusions?".`,
      text: {
        format: zodTextFormat(questionsFormat, 'questions'),
      },
      reasoning: {
        effort: "low"
      }
    })

    return response.output_parsed?.questions || []
  }
}