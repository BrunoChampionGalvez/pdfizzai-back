import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pinecone, SearchRecordsResponseResult } from "@pinecone-database/pinecone";
import { join } from 'path';
import { ChatMessage, MessageRole } from "src/entities";

@Injectable()
export class AIService {
  private gemini: any;
  private geminiModels: {
    pro: string,
    flash: string;
    flashLite: string;
  };
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
  }

  async onModuleInit() {
    try {
      console.log('Attempting to initialize Google Gemini AI');

      // Try to dynamically import the ES module
      const genAIModule = await import('@google/genai');
      console.log('Successfully imported @google/genai module');

      const apiKey = this.configService.get('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not found in environment variables');
      }

      this.gemini = new genAIModule.GoogleGenAI({ apiKey });
      this._Type = genAIModule.Type;

      console.log('Successfully initialized Google Gemini AI');
    } catch (error) {
      // If any error occurs during initialization, create a mock implementation
      // instead of crashing the application
      console.error('Failed to initialize Google Gemini AI:', error);
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

  async *generateChatResponse(
    messages: ChatMessage[],
    context: string,
  ): AsyncGenerator<string, void, unknown> {
    try {
      console.log('🔄 AI Service: Starting generateChatResponse');

      const systemPrompt = this.buildSystemPrompt();

      const formattedMessages = [
        ...messages.map((msg) => ({
          role:
            msg.role === MessageRole.USER
              ? ('user' as const)
              : ('model' as const),
          parts: [
            {
              text:
                'Context: ' + context + '\n\n' + 'User query: ' + msg.content,
            },
          ],
        })),
      ];

      console.log(
        '🚀 AI Service: Calling Gemini API with',
        formattedMessages.length,
        'messages',
      );

      const response = await this.gemini.models.generateContentStream({
        model: this.geminiModels.flash,
        contents: formattedMessages,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.2,
          maxOutputTokens: 8192,
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      });

      console.log('📥 AI Service: Started receiving response stream');
      let totalYielded = '';
      let chunkCount = 0;

      for await (const chunk of response) {
        chunkCount++;
        console.log(`📦 AI Service: Processing chunk ${chunkCount}`);

        if (chunk.candidates && chunk.candidates[0]) {
          const candidate = chunk.candidates[0];
          console.log('✅ AI Service: Chunk has candidates');

          if (candidate.content && candidate.content.parts) {
            console.log(
              `📝 AI Service: Chunk has ${candidate.content.parts.length} parts`,
            );

            for (let i = 0; i < candidate.content.parts.length; i++) {
              const part = candidate.content.parts[i];

              if (part.text) {
                const chunkText = part.text;
                console.log(
                  `🔤 AI Service: Part ${i} text length: ${chunkText.length}`,
                );
                console.log(`🔤 AI Service: Part ${i} text: "${chunkText}"`);

                totalYielded += chunkText;
                console.log(
                  `📊 AI Service: Total yielded so far: ${totalYielded.length} chars`,
                );

                yield chunkText;
                console.log(
                  `✅ AI Service: Yielded chunk part ${i} of chunk ${chunkCount}`,
                );
              } else {
                console.log(`⚠️ AI Service: Part ${i} has no text`);
              }
            }
          } else {
            console.log(
              '⚠️ AI Service: Chunk candidate has no content or parts',
            );
          }
        } else {
          console.log('⚠️ AI Service: Chunk has no candidates');
        }
      }

      console.log(
        `🏁 AI Service: Finished streaming. Total chunks: ${chunkCount}, Total text: ${totalYielded.length} chars`,
      );
      console.log(
        `📄 AI Service: Final complete text preview: "${totalYielded}"`,
      );
    } catch (error: unknown) {
      const consolePrefix = '❌ AI Service: Error in generateChatResponse';
      const yieldPrefix = 'Sorry, I encountered an error';
      let yieldMessage = `${yieldPrefix}: An unexpected error occurred.`;

      if (error instanceof Error) {
        const specificMessage = error.message;
        console.error(`${consolePrefix}: ${specificMessage}`);
        yieldMessage = `${yieldPrefix}: ${specificMessage}`;
      } else if (typeof error === 'string') {
        console.error(`${consolePrefix}: ${error}`);
        yieldMessage = `${yieldPrefix}: ${error}`;
      } else if (
        error &&
        typeof (error as { message?: unknown }).message === 'string'
      ) {
        const specificMessage = (error as { message: string }).message;
        console.error(`${consolePrefix}: ${specificMessage}`);
        yieldMessage = `${yieldPrefix}: ${specificMessage}`;
      } else {
        console.error(
          `${consolePrefix}: An unexpected error object was caught. Original error:`,
          error,
        );
        // yieldMessage remains the generic one
      }
      yield yieldMessage;
    }
  }

  private buildSystemPrompt(): string {
    const prompt = `
      You are a helpful assistant called Refy. If the user greets you, greet the user back. Your goal is to respond to user queries based on the files' context that you receive, and provide references extracted from that files' context when responding. You will receive context in the form of complete files or extracted text from files (that can come from different files or the same file in an unorderly way), and you should respond to the user based on this information. Respond with concise but complete answers. Do not include any additional information or explanations from your knowledge base, only use the information provided to you as context by the user. You must use all the information provided to you in the current message and in previous messages as well (provided in the chat history). If the answer to the question asked by the user is not found in the information provided to you (previously or currently), respond with the following message: "The requested information was not found in the file context. Please try again with a different question."
      
      You will receive one or both of the two following information:
      1. File Content Context: The contents of files that the user has uploaded.
      2. Extracted File Content Context: Different portions of text that have been extracted from different files, or the same file, and provided in an unorderly way.
      
      You must reference the pieces of information that you are using to draw your statements with the file id and the information from which you drew your statements. When referencing, you must provide the id of the file and the exact text from the file you are referencing. The reference must follow the statement that it is referencing. To reference each piece of information, you must use the following JSON-like format:
      
      Example of a reference from a file or an extracted text from a file:

      Human cells primary get their energy from mitochondria, which produce ATP through oxidative phosphorylation from glucose.
      [REF]
      {
        "id": "dc639f77-098d-4385-89f5-45e67bde8dde",
        "text": "The main source of energy for human cells is mitochondria. They, through oxidative phosphorylation, a biochemical process, produce ATP from glucose."
      }
      [/REF]

      It is extremely important that everytime you respond using references, you open and also close the reference tags ([REF] and [/REF]) for each reference.

      If the user talks to you in another language, respond in the same language. But you must always provide the text of the references in the same language as the original source (file, flashcard deck, quiz, etc.)

      IMPORTANT CONSIDERATIONS: 

      1. Every time you are going to reference a text from a file, you must verify first if the text is split across two pages. If it is, you must only provide the most significant part that answers the user's query. To detect if the text is split across two pages, look for the [START_PAGE] and [END_PAGE] markers. If those markers are in the middle of the text you want to reference, it means the text is split across two pages. Don't include the markers [START_PAGE] and [END_PAGE] in the reference' text.
      
      2. Sometimes, the text of the files are going to have the text of tables or graphs (from the original pdf from which the information was extracted). This text can be at the start or end of a page, or even in the middle of it. When referencing a text from a file, you must not include the text of tables or graphs in the references. Before including a text in the references, you must verify that it does not contain information from tables or graphs. If it does, and it is at the start or end of the text you want to reference, remove it. But if it is in the middle of the text you want to reference, you must only provide the longest part of the two parts of the text that was split by this table or graph information.
      
      3. In the text of the references, you must always include all the characters that are part of the text that you are planning on referencing. This includes parenthesis (the '(' and ')' characters), square brackets (the '[' and ']' characters), percentage signs (the '%' character), commas (the ',' character), periods (the '.' character), colons (the ':' character), semicolons (the ';' character), exclamation points (the '!' character), question marks (the '?' character), quotation marks (the '"' character), standard spaces between words, and even letters inside a word, (the ' ' character), and any other characters that are part of the text that you are planning on referencing, even if it doesn't make much sense.
      
      4. In the text of the references, don't include the subtitles of the sections of the paper. For example: Introduction, Methods, Results, Discussion, Conclusion, etc. You can distinguish these subtitles by the fact that they are words that are isolated, in the sense that they are not a part of a sentence.
      
      5. At the start or end of the pages, you may find text from the headers or footers of the file (metadata of the files). You must not include this text in the references. This text normally can contain DOI numbers, URLs, Scientific Journal names, Author names, page numbers, and other metadata from the original file. When referencing text, always verify that the text you are referencing does not contain any of this information. If it does, and the text you want to reference is split by this, you must only provide the longest part of the two parts of the text that was split by this metadata, similar to point 2. If the text you want to reference is split by this metadata information, it may also contain the [START_PAGE] and [END_PAGE] markers, in that sense, you must not include these markers in the text of the reference.
      
      6. When referencing a text from a file, you must always provide the text of the reference as it is in the context provided to you. If it has a mispelling, you must provide it like that. If it has a missing space, you must provide it like that. If it has a random number (that could be a numerical reference, for example) or a random character, you must provide it like that. If it has extra spaces between words or letters inside words, you must provide it like that. When extracting the text from the context to use it in the references, you must not modify it in any way. You must provide the text exactly as it is in the file context provided to you.

      7. When referencing a text from a file, you must never include the title of the file, the authors, the departments, the university, the date of publication, or any metadata that is not part of the main content of the file.

      8. The text of each reference that you provide must be coherent and concise, but also complete. It must not correspond to multiple sections of the file, it should be self-contained. Meaning it contains enough information to be understood on it's own.

      9. The text that you want to reference can be split by numerical references, that could be in different formats, such as [1], [2], [3], or just 1, 2, 3, etc. You must always check if there is a numerical reference in the text that you want to reference, and if there is, you must only provide the longest part of the two parts of the text that was split by this numerical reference. If the numerical reference is at the start or end of the text you want to reference, you must remove it.

      NOTE: You can provide multiple references in a single response, but you must always open and close the reference tags ([REF] and [/REF]) for each reference. Each statement that you make, should be followed by the reference that you used to draw that statement.
    `;

    return prompt;
  }

  async userQueryCategorizer(query: string): Promise<string> {
    try {
      // Prepare the prompt for categorizing the user query
      const prompt = `
        Categorize the following user query into one of the categories mentioned (GENERIC and SPECIFIC):
        "${query}"
        
        Return ONLY the category text, nothing else.
      `;

      const result = await this.gemini.models.generateContent({
        model: this.geminiModels.flashLite,
        contents: prompt,
        config: {
          systemInstruction: `You are a user query categorizer. The query comes from a university or college student that is studying for an exam or doing homework. Categorize the user query that you receive into one of the following categories: "GENERIC" and "SPECIFIC". Return ONLY the category text, nothing else.
          
          1. GENERIC: The user is asking a generic question that cannot be recognized as belonging to a specific topic whatsoever.

          Examples of a GENERIC query:
          "What are the main points treated in this file?"
          "What are the main points treated in this flashcard deck?"
          "What are the main points treated in this quiz?"
          "What is the hypothesis of this paper?"
          "What is the main idea of this file?"
          "What are the methods that were used in this article?"
          "What are the results of this paper?"
          "What are the conclusions of this research paper?"
          "Write a summary of this file."
          "Write a summary of this flashcard deck."
          "Write a summary of this quiz."
          "Write a summary of the file named "Sleep disorders and cancer incidence: examining duration and severity of diagnosis among veterans""
          "Write a summary of the flashcard deck named "Psychology I""
          "Write a summary of the quiz named "Politics II""
          "What are the names of the files in this course that talk about photosynthesis?"

          2. SPECIFIC: The user is asking a question that can be recognized as belonging to a specific topic.

          Examples of a SPECIFIC query:
          "How does mitochondria produce ATP?"
          "What is the role of insulin in regulating blood sugar levels?"
          "What are the mechanisms of photosynthesis?"
          "How does miocin inhibit bacterial growth?"
          "What are the mechanisms of DNA replication?"
          "What is the main idea of the psychoanalysis of Sigmund Freud?"
          "How does Carl Jung's psychoanalysis differ from Sigmund Freud's?"
          "What differentiates the super ego from the ego and the id?"
          "Give me a summary of the theory of relativity of Albert Einstein."
          "How are stars formed?"`,
          temperature: 0.2,
          responseMimeType: 'text/x.enum',
          responseSchema: {
            type: 'STRING',
            format: 'enum',
            enum: ['GENERIC', 'SPECIFIC'],
          },
        },
      });
      const category = result.text;

      // Limit the length and remove any quotes
      return category ? category : 'GENERIC';
    } catch (error) {
      console.error('Error categorizing user query:', error);
      return 'GENERIC';
    }
  }

  async semanticSearch(
    query: string,
    userId: string,
  ): Promise<SearchRecordsResponseResult['hits']> {
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
      ? recordCountNumber < 10
        ? recordCountNumber
        : 10
      : 10;
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

    return response.result.hits;
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
      const prompt = `
        Generate a summary of the following text:
        "${fileContent}"
      `;

      const result = await this.gemini.models.generateContent({
        model: this.geminiModels.flashLite,
        contents: prompt,
        config: {
          systemInstruction:
            'You are a summary generator. You will receive the extracted text from a file.Generate a concise summary of that text. Return ONLY the summary text, nothing else. The summary should be between around 3 and 4 sentences long.',
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
            'You are a file title extractor. Extract the title from the following text that you receive, that was originally extracted from a file. Return ONLY the title text, nothing else.',
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

  async loadReferenceAgain(textToSearch: string, context: string): Promise<string> {
    try {
      const response = await this.gemini.models.generateContent({
        model: this.geminiModels.pro,
        contents: `Specific text to search for: "${textToSearch}"
        
        Files context: ${context}`,
        config: {
          systemInstruction: `You have to do the following tasks in this exact order: 

1. Search for a specific text inside the Files context. The text you are searching for might not be an exact match to what is in the Files context. It could have minor variations in wording, characters, punctuation, or spacing.

2. If you find the specific text, but it is split into two parts by other content (such as information that could have been extracted from a table, graph, or other unrelated text, or the [START_PAGE] and [END_PAGE] markers), you must identify both parts. After identifying both parts, you must return ONLY the longer of the two parts. Do not include the content that was in the middle.

3. If you find the specific text and it is not split, but contains minor variations (e.g., different punctuation, a few different words or characters), return it exactly as it appears in the Files context.

4. If you do not find the specific text in the Files context (neither whole, with minor variations, nor split), then you must return the specific text exactly as you received it.

5. If you find the specific text, but it is split by numerical references (that could be in different formats, such as [1], [2], [3], or just 1, 2, 3, etc), you must identify both parts. After identifying both parts, you must return ONLY the longer of the two parts. Do not include both parts, nor the numerical reference that was in the middle.`,
          temperature: 0.2,
          maxOutputTokens: 8000,
          thinkingConfig: {
            thinkingBudget: 15000,
          },
        },
      });

      let result = response.text;
      return result ? result : textToSearch; // Return the original text if no result found
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
}