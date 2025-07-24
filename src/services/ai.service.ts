import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pinecone, SearchRecordsResponseResult } from "@pinecone-database/pinecone";
import { join } from 'path';
import { ChatMessage, MessageRole } from "src/entities";

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
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

  async *generateChatResponse(
    messages: ChatMessage[],
    context: string,
  ): AsyncGenerator<string, void, unknown> {
    try {
      this.logger.debug('Starting generateChatResponse');

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

      this.logger.debug(
        `Calling Gemini API with ${formattedMessages.length} messages`,
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
        this.logger.verbose(`Processing chunk ${chunkCount}`);

        if (chunk.candidates && chunk.candidates[0]) {
          const candidate = chunk.candidates[0];
          this.logger.verbose('Chunk has candidates');

          if (candidate.content && candidate.content.parts) {
            this.logger.verbose(
              `Chunk has ${candidate.content.parts.length} parts`,
            );

            for (let i = 0; i < candidate.content.parts.length; i++) {
              const part = candidate.content.parts[i];

              if (part.text) {
                const chunkText = part.text;
                this.logger.verbose(
                  `Part ${i} text length: ${chunkText.length}`,
                );
                this.logger.verbose(`Part ${i} text: "${chunkText.substring(0, 100)}..."`);

                totalYielded += chunkText;
                this.logger.verbose(
                  `Total yielded so far: ${totalYielded.length} chars`,
                );

                yield chunkText;
                this.logger.verbose(
                  `Yielded chunk part ${i} of chunk ${chunkCount}`,
                );
              } else {
                this.logger.warn(`Part ${i} has no text`);
              }
            }
          } else {
            this.logger.warn(
              'Chunk candidate has no content or parts',
            );
          }
        } else {
          this.logger.warn('Chunk has no candidates');
        }
      }

      this.logger.debug(
        `Finished streaming. Total chunks: ${chunkCount}, Total text: ${totalYielded.length} chars`,
      );
      this.logger.verbose(
        `Final complete text preview: "${totalYielded.substring(0, 200)}..."`,
      );
    } catch (error: unknown) {
      const yieldPrefix = 'Sorry, I encountered an error';
      let yieldMessage = `${yieldPrefix}: An unexpected error occurred.`;

      if (error instanceof Error) {
        const specificMessage = error.message;
        this.logger.error(`Error in generateChatResponse: ${specificMessage}`, error.stack);
        yieldMessage = `${yieldPrefix}: ${specificMessage}`;
      } else if (typeof error === 'string') {
        this.logger.error(`Error in generateChatResponse: ${error}`);
        yieldMessage = `${yieldPrefix}: ${error}`;
      } else if (
        error &&
        typeof (error as { message?: unknown }).message === 'string'
      ) {
        const specificMessage = (error as { message: string }).message;
        this.logger.error(`Error in generateChatResponse: ${specificMessage}`);
        yieldMessage = `${yieldPrefix}: ${specificMessage}`;
      } else {
        this.logger.error(
          'An unexpected error object was caught in generateChatResponse',
          error,
        );
        // yieldMessage remains the generic one
      }
      yield yieldMessage;
    }
  }

  private buildSystemPrompt(): string {
    const prompt = `
      You are a helpful assistant. If the user greets you, greet the user back. Your goal is to respond to user queries based on the files context content that you receive, and provide references extracted from that files' context content when responding. You will receive context in the form of extracted sections of text from files (that can come from different files or the same file in an unorderly way), and you should respond to the user based on this information. Respond with concise but complete answers. Do not include any additional information or explanations from your knowledge base, only use the information provided to you as context by the user. You must use all the information provided to you in the current message and in previous messages as well (provided in the chat history). If the answer to the question asked by the user is not found in the information provided to you (previously or currently), respond with the following message: "The requested information was not found in the file context. Please try again providing more context."
      
      You will receive the following information:
      1. File Content Context: Different portions of text that have been extracted from different files, or the same file, and provided in an unorderly way.
      
      You must reference the pieces of information that you are using to draw your statements with the file id and the information from which you drew your statement. When referencing, you must provide the id of the file and the exact text from the file you are referencing. The reference must follow the statement that it is referencing. To reference each piece of information, you must use the following JSON-like format:
      
      Example of a reference from a file or an extracted text from a file:

      Human cells primary get their energy from mitochondria, which produce ATP through oxidative phosphorylation from glucose.
      [REF]
      {
        "id": "dc639f77-098d-4385-89f5-45e67bde8dde",
        "text": "The main source of energy for human cells is mitochondria. They, through oxidative phosphorylation, a biochemical process, produce ATP from glucose."
      }
      [/REF]

      It is extremely important that everytime you respond using references, you open and also close the reference tags ([REF] and [/REF]) for each reference.

      If the user talks to you in another language, respond in the same language as him. But you must always provide the text of the references in the same language as the original source.

      IMPORTANT CONSIDERATIONS: 

      1. Every time you are going to reference a text from a file, you must verify first if the text is split across two pages. If it is, you must only provide the most significant part that answers the user's query. To detect if the text is split across two pages, look for the [START_PAGE] and [END_PAGE] markers. If those markers are in the middle of the text you want to reference, it means the text is split across two pages. Don't include the markers [START_PAGE] and [END_PAGE] in the reference' text.
      
      2. Sometimes, the text of the files are going to have the text of tables or graphs (from the original pdf from which the information was extracted). This text can be at the start or end of a page, or even in the middle of it. When referencing a text from a file, you must not include the text of tables or graphs in the references. Before including a text in the references, you must verify that it does not contain information from tables or graphs. If it does, and it is at the start or end of the text you want to reference, remove it. But if it is in the middle of the text you want to reference, you must only provide the longest part of the two parts of the text that was split by this table or graph information.
      
      3. In the text of the references, you must always include all the characters that are part of the text that you are planning on referencing. This includes parenthesis (the '(' and ')' characters), square brackets (the '[' and ']' characters), percentage signs (the '%' character), commas (the ',' character), periods (the '.' character), colons (the ':' character), semicolons (the ';' character), exclamation points (the '!' character), question marks (the '?' character), quotation marks (the '"' character), hyphens (the '-' character), standard spaces between words, and even letters inside a word, (the ' ' character), and any other characters that are part of the text that you are planning on referencing, even if it doesn't make much sense.

      4. In the text of the references, you must never add any characters that are not part of the text that you are planning on referencing. This includes the characters mentioned in point 3, but also any other characters that are not part of the text that you are planning on referencing.
      
      5. When referencing, if the text you are planning on referencing has an additional word or character next to it (either at the beginning or at the end), with no spaces between the text and the additional word or character, you must never split the two. Provide the text and the additional word or character together, as it appears in the context provided to you. For example, if the text is "There were no significant differences between the two groups.", and the context has "methodsThis was a randomized controlled trial in which 137 participants were enrolled.", you must provide the text of the reference as: "methodsThis was a randomized controlled trial in which 137 participants were enrolled.". Never provide the specific text without the additional word or character, if it corresponds, even if the two don't make much sense together.
      
      6. At the start or end of the pages, you may find text from the headers or footers of the file (metadata of the files). You must not include this text in the references. This text normally can contain DOI numbers, URLs, Scientific Journal names, Author names, page numbers, and other metadata from the original file. When referencing text, always verify that the text you are referencing does not contain any of this information. If it does, and the text you want to reference is split by this, you must only provide the longest part of the two parts of the text that was split by this metadata, similar to point 2. If the text you want to reference is split by this metadata information, it may also contain the [START_PAGE] and [END_PAGE] markers, in that sense, you must not include these markers in the text of the reference.
      
      7. When referencing, you must always provide the text of the reference as it is in the context provided to you. If it has a mispelling, you must provide it like that. If it has a missing space, you must provide it like that. If it has a random number (that could be a numerical reference, for example) or a random character, you must provide it like that. If it has extra spaces between words or letters inside words, you must provide it like that. When extracting the text from the context to use it in the references, you must not modify it in any way. You must provide the text exactly as it is in the file context provided to you.

      8. When referencing a text from a file, you must never include the title of the file, the authors, the departments, the university, the date of publication, or any metadata that is not part of the main content of the file.

      9. The text of each reference that you provide must be coherent and concise, but also complete. It must not correspond to multiple sections of the file, it should be self-contained. Meaning it contains enough information to be understood on it's own. The text of each reference must never be too long, that is, it must not exceed around 150 words. If you need to provide more information, you must split it into multiple references, each with a coherent text that is self-contained.

      10. The text that you want to reference can be split by numerical references, that could be in different formats, such as [1], [2], [3], or just 1, 2, 3, etc. You must always check if there is a numerical reference in the text that you want to reference, and if there is, you must only provide the longest part of the two parts of the text that was split by this numerical reference. If the numerical reference is at the start or end of the text you want to reference, you must remove it.

      11. In the statements that you provide that are outside of the references, you must never provide the ids of the files of the text provided in the context. You can provide the titles of the files, but never the ids. The ids are only for the references that you provide.

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
          systemInstruction: `You are a user query categorizer. Categorize the user query that you receive into one of the following categories: "GENERIC" and "SPECIFIC". Return ONLY the category text, nothing else.
          
          1. GENERIC: The user is asking a generic question that cannot be recognized as belonging to a specific topic whatsoever.

          Examples of a GENERIC query:
          "What are the main points treated in this file?"
          "What is the hypothesis of this paper?"
          "What is the main idea of this file?"
          "What are the methods that were used in this article?"
          "What are the results of this paper?"
          "What are the conclusions of this research paper?"
          "Write a summary of this file."
          "Write a summary of the file named "Sleep disorders and cancer incidence: examining duration and severity of diagnosis among veterans""
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

  async loadReferenceAgain(textToSearch: string, context: string): Promise<string> {
    try {
      const response = await this.gemini.models.generateContent({
        model: this.geminiModels.pro,
        contents: `Specific text to search for: "${textToSearch}"
        
        Files context: ${context}`,
        config: {
          systemInstruction: `You have to do the following tasks in this exact order: 

1. Search for a specific text inside the Files context, that is a set of text snippets from one or more files that are distributed in an unorderly way. The text you are searching for might not be an exact match to what is in the Files context. It could have minor variations in wording, characters, punctuation, or spacing.

2. If you find the specific text, but it is split into two parts by other content (such as information that could have been extracted from a table, graph, or other unrelated text, or the [START_PAGE] and [END_PAGE] markers), you must identify both parts. After identifying both parts, you must return ONLY the longer of the two parts. Do not include the content that was in the middle.

3. If you find the specific text and it is not split, but contains minor variations (e.g., different punctuation, a few different words or characters), return it exactly as it appears in the Files context. 

4. If you find the specific text and it has an additional word or character next to it (either at the beginning or at the end), with no spaces between the specific text and the additional word or character, you must never split the two. Return the specific text and the additional word or character together, as it appears in the Files context. For example, if the specific text is "There were no significant differences between the two groups.", and the Files context has "methodsThis was a randomized controlled trial in which 137 participants were enrolled.", you must return "methodsThis was a randomized controlled trial in which 137 participants were enrolled.". Never return the specific text without the additional word or character, if it corresponds, even if the two don't make much sense together. If the additional word or character is part of a larger text or phrase, you must only return the specific text next to the additional word or character, and ignore the other part, even if it doesn't make sense. For example, if the specific text is "We conducted a randomized controlled trial in which 137 participants were enrolled.", and the Files context has "Materials and methodsThis was a randomized controlled trial in which 137 participants were enrolled.", you must return "methodsThis was a randomized controlled trial in which 137 participants were enrolled.". You must always return the specific text and the additional word or character together, when it corresponds, and nothing more.

IMPORTANT: The previous point 4 doesn't apply if the specific text is split by numerical references (that could be in different formats, such as [1], [2], [3], or just 1, 2, 3, etc). In that case, you must identify both parts and return ONLY the longer of the two parts. Do not include both parts, nor the numerical reference that was in the middle.

5. If you do not find the specific text in the Files context (neither whole, with minor variations, nor split), then you must return the specific text exactly as you received it.

6. If you find the specific text, but it is split by numerical references (that could be in different formats, such as [1], [2], [3], or just 1, 2, 3, etc), you must identify both parts. After identifying both parts, you must return ONLY the longer of the two parts. Do not include both parts, nor the numerical reference that was in the middle. Take into account that the numerical references could be separated by a comma, a space, or enclosed in square brackets, so you must be careful to identify them correctly.`,
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

  async generateQuestionsFromQuery(userQuery: string, lastSixMessages: ChatMessage[], fileContents: Array<{ id: string; name: string; summary: string }>): Promise<string[]> {
    try {
      const response = await this.gemini.models.generateContent({
        model: this.geminiModels.flash,
        contents: `<user_query>${userQuery}</user_query><last_six_messages>${lastSixMessages.map(message => `<message><role>${message.role}</role><content>${message.content}</content><files_summaries>${message.referencedFiles && message.referencedFiles.length > 0 ? message.referencedFiles.map(file => `<file_summary><name>${file.filename}</name><summary>${file.summary}</summary></file_summary>`).join('') : ''}</files_summaries></message>`).join('')}</last_six_messages><files_summaries>${fileContents && fileContents.length > 0 ? fileContents.map(file => `<file_summary><name>${file.name}</name><summary>${file.summary}</summary></file_summary>`).join('') : ''}</files_summaries>`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'array',
            items: {
              type: 'string',
            }
          },
          systemInstruction: `Your task is to generate specific questions based on the provided user query, files summaries and the four last messages from a chat (that could each probably contain the summaries sent with them). You will receive a user query, the summaries from one or more files, and the last six messages from a chat. Your goal is to generate between 2 and 6 specific questions, depending on what the user query demands, that can be used to search for information in a vector store that contains the whole text of the files and that will be later used to answer to the user query. The questions should be specific and related to the content of the files. Use the last six messages from the chat to understand the context of the user query so that you can generate relevant questions. If the user query is generic, and the aswer has already been provided in the chat, you should generate questions that can be used to search for information in the vector store that can respond to the user query in a more specific or different way, or that can provide more details about the topic. You must provide the questions in a JSON array format, with each question as a string. Do not include any additional text or explanations, just the JSON array with the questions.

          Examples of specific questions:
          1. "What are the effects of miocin on bacterial growth?"
          2. "How does the theory of relativity explain the curvature of spacetime?"
          3. "What are the mechanisms of photosynthesis in plants?"
          4. "What are the main differences between Freud's and Jung's theories of psychoanalysis?"
          5. "What is the role of mitochondria in ATP production?"
          6. "How does insulin regulate blood sugar levels in the human body?"
          
          Examples of generic questions (that you should not generate):
          1. "What are the main points treated in this file?"
          2. "What is the hypothesis of this paper?"
          3. "What is the main idea of this file?"
          4. "What are the methods that were used in this article?"
          5. "What are the results of this paper?"
          6. "What are the conclusions of this research paper?"
          7. "Write a summary of this file."
          8. "Write a summary of the file named [NAME_OF_FILE]"
          
          Example of flow:
          [EXAMPLE]
          User query provided: "What are the key points treated in the file?"
          Files summaries provided: 
          "File 1: Cancer Incidence and Sleep Disorders in U.S. Veterans.
          File summary: The study discusses the effects of sleep disorders on cancer incidence, examining the duration and severity of diagnosis among veterans. It highlights the importance of understanding the relationship between sleep disorders and cancer risk, and suggests that further research is needed to explore this connection...This study was based on a U.S. Department of Veterans Affairs database, which provided a large sample size of veterans with sleep disorders and cancer diagnoses... The study found that veterans with sleep disorders had a higher risk of developing cancer, particularly those with more severe sleep disorders..."
          File 2: [NAME_OF_FILE]
          File summary: [FILE_SUMMARY]
          ...
          File N: [NAME_OF_FILE]
          File summary: [FILE_SUMMARY]

          Specific questions generated:
          1. "What is the relationship between sleep disorders and cancer risk in veterans?"
          2. "What was the population studied in the research on sleep disorders and cancer?"
          3. "What were the key findings of the study on sleep disorders and cancer in veterans?"
          4. "What are the implications of the study's findings for veterans with sleep disorders?"
          5. "What further research is needed to understand the relationship between sleep disorders and cancer in veterans?"
          [/EXAMPLE]

          As you can notice, the specific questions generated are focused on extracting detailed information from the file summaries, rather than asking generic questions about the files themselves. This approach helps to ensure that the questions are relevant and can lead to more precise answers when searching the vector store.
          
          Note: You will receive the information in the following format:
          <user_query>...</user_query><files_summaries>...</files_summaries>
          `,
          temperature: 0.2,
          maxOutputTokens: 8000,
        },
      });

      let result = response.text;
      return result ? JSON.parse(result) : []; // Return an empty array if no result found
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
    return [];
  }
}