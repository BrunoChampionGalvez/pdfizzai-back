import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { File } from '../entities/file.entity';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { AIService } from './ai.service';
import { Pinecone } from '@pinecone-database/pinecone';
import { ChatSession, Folder } from 'src/entities';
import { Storage } from '@google-cloud/storage';
import { SubscriptionUsage } from 'src/entities/subscription-usage.entity';
import { ExtractedContent } from 'src/entities/extracted-content.entity';

@Injectable()
export class FileService {
  private readonly uploadPath = path.join(process.cwd(), 'uploads');
  private pc: Pinecone;
  private googleStorage: Storage;

  constructor(
    private configService: ConfigService,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(SubscriptionUsage)
    private subscriptionUsageRepository: Repository<SubscriptionUsage>,
    private aiService: AIService, // Assuming you have an AI service for text extraction and summarization
    @InjectRepository(ExtractedContent)
    private extractedContentRepository: Repository<ExtractedContent>,
    @InjectRepository(ChatSession)
    private chatSessionRepository: Repository<ChatSession>,
  ) {
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath, { recursive: true });
    }
    this.pc = new Pinecone({
      apiKey: this.configService.get('PINECONE_API_KEY') as string,
    });
    this.googleStorage = new Storage({
      apiKey: this.configService.get('GCS_API_KEY') as string,
    });
  }

  async findOne(id: string): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id }})

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    /*if (!file.google_storage_url || file.expires || Date.now() > file.expires - 300000) {
      // expired or within 5 min of expiry
      const newSig = await this.generateUrl(file.filename);
      file.google_storage_url = newSig.url;
      file.expires = newSig.expires;
      await this.fileRepository.save(file);
    }*/

    return file;
  }

  async generateUrl(fileName, ttlSec = 3600) {
    const [url] = await this.googleStorage
      .bucket(this.configService.get('GCS_BUCKET_NAME') as string)
      .file(fileName)
      .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + ttlSec * 1000 });
    return { url, expires: Date.now() + ttlSec * 1000 };
  }

  async uploadFile(
    userId: string,
    fileData: Express.Multer.File,
    folderId?: string | null,
  ): Promise<File> {

    if (fileData.size > 100 * 1024 * 1024) {
      throw new BadRequestException('Course size limit of 100MB exceeded');
    }
    
    // Store the file on disk and create a physical path
    const uploadsDir = 'uploads';
    // Ensure the uploads directory exists
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = `${userId}_${Date.now()}_${fileData.originalname}`;
    fs.writeFileSync(filePath, fileData.buffer);
    const virtualPath = filePath;

    try {
      const response = await this.googleStorage.bucket(this.configService.get('GCS_BUCKET_NAME') as string).upload(virtualPath);
      console.log('File uploaded to Google Cloud Storage:', response);
    } catch (error) {
      console.error('Error uploading file to Google Cloud Storage:', error);
      throw new BadRequestException('Failed to upload file to cloud storage');
    }

    // Upload the file to Google Cloud Storage
    /*await axios.post(
      `https://storage.googleapis.com/upload/storage/v1/b/${this.configService.get('GCS_BUCKET_NAME')}/o?uploadType=media&name=${encodeURIComponent(virtualPath)}`,
      fileData.buffer, // send the binary data directly
      {
      headers: {
        'Authorization': `Bearer ${this.configService.get('GCS_ACCESS_TOKEN')}`,
        'Content-Type': fileData.mimetype,
      },
      },
    );*/

    // Delete the file from the uploads directory after upload
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`Failed to delete local file ${filePath}:`, err);
    }

    // Create file entity
    const file = this.fileRepository.create({
      originalName: fileData.originalname,
      storage_path: virtualPath, // Store a virtual path instead of a physical file path
      mime_type: fileData.mimetype,
      size_bytes: fileData.size,
      owner_id: userId,
      owner: { id: userId }, // Assuming you have a User entity with an id field
      // Only set folder_id if it's provided and not null
      ...(folderId ? { folder_id: folderId } : {}),
    });

    /*const newSig = await this.generateUrl(virtualPath);
    file.google_storage_url = newSig.url;
    file.expires = newSig.expires;*/

    const savedFile = await this.fileRepository.save(file);

    return savedFile;
  }

  async getFileById(userId: string, fileId: string): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id: fileId, owner_id: userId },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return file;
  }

  async deleteFile(userId: string, fileId: string): Promise<void> {
    const file = await this.findOne(fileId);

    if (!file) {
      throw new NotFoundException(`File with ID ${fileId} not found`);
    }
    
    const index = this.pc.index(this.configService.get('PINECONE_INDEX_NAME') as string, this.configService.get('PINECONE_INDEX_HOST') as string);
    const ns = index.namespace(userId)

    await ns.deleteMany({
      fileId: { $eq: file.id  },
    });
    await this.fileRepository.remove(file);
  }

  async getFilesByFolderId(userId: string, folderId: string): Promise<File[]> {
    return this.fileRepository.find({
      where: { folder_id: folderId, owner_id: userId },
    });
  }

  async getRootFiles(userId: string): Promise<File[]> {
    return this.fileRepository.find({
      where: { folder_id: undefined, owner_id: userId },
    });
  }

  async getAllUserFiles(userId: string): Promise<File[]> {
    return this.fileRepository.find({
      where: { owner_id: userId },
      order: { upload_date: 'DESC' },
    });
  }

  async findOneForChat(id: string): Promise<File> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['referencedMessages']
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    return file;
  }

  /**
   * Save extracted text from PDF.js Express
   * @param id The ID of the research paper
   * @param userId The user ID for permission checking
   * @param textByPages The extracted text organized by page numbers
   * @returns The updated research paper entity
   */
  async saveExtractedText(id: string, userId: string, textByPages: string, totalPages?: number): Promise<File> {
    // Get the research paper and verify ownership
    const paper = await this.findOne(id);
    
    if (!paper) {
      throw new NotFoundException(`Research paper with ID ${id} not found`);
    }

    // Generate summary
    //const summary = await this.aiService.generateSummary(textByPages);

    const chunks = this.createChunksWithOverlap(textByPages);

    // Create file name with AI
    const quarterLength = Math.floor(textByPages.length / 4);
    const fileName = await this.aiService.generateFileName(
      textByPages.slice(0, quarterLength),
    );

    // Generate summary
    const summary = await this.aiService.generateSummary(textByPages);

    // Generate specific questions for user generic queries
    const descriptionAndQuestions = await this.aiService.generateQuestionsFromFile(
      textByPages,
    );

    // Update the paper with extracted text and mark as extracted
    let updatedPaper = await this.fileRepository.save({
      ...paper,
      description: descriptionAndQuestions.description ? descriptionAndQuestions.description : '',
      questions: descriptionAndQuestions.questions && descriptionAndQuestions.questions.length > 0 ? descriptionAndQuestions.questions : [],
      textByPages,
      //summary,
      chunks,
      filename: fileName,
      processed: true, // Mark as processed since we've extracted the content
      textExtracted: true,
      totalPages,
      summary,
      storage_path: paper.storage_path,
      originalName: paper.originalName,
      mime_type: paper.mime_type,
      size_bytes: paper.size_bytes
    });

    const subscriptionUsage = await this.subscriptionUsageRepository.findOne({
      where: { subscription: { user: { id: userId } } },
    });
    if (!subscriptionUsage) {
      throw new NotFoundException('Subscription usage not found for user');
    }
    subscriptionUsage.filePagesUploaded += totalPages || 1; // Increment file pages uploaded count

    // Upsert text
    const namespace = this.pc
      .index(
        this.configService.get('PINECONE_INDEX_NAME') as string,
        this.configService.get('PINECONE_INDEX_HOST') as string,
      )
      .namespace(userId);

    await namespace.upsertRecords(
      chunks.map((chunk, index) => ({
        _id: `${id}-${index}`,
        chunk_text: chunk.replace(/\n/g, ''),
        fileId: id,
        name: fileName,
        userId: userId, // Include userId for better context
      })),
    );

    return updatedPaper;
  }

  /**
   * Creates text chunks with specified overlap
   * @param text The full text to chunk
   * @param chunkSize The size of each chunk in words (default: 400)
   * @param overlapSize The overlap between chunks in words (default: 100)
   * @returns Array of text chunks with specified overlap
   */
  private createChunksWithOverlap(
    text: string | null,
    chunkSize: number = 400,
    overlapSize: number = 100,
  ): string[] {
    // Split the text into words
    const words = text?.split(/\s+/).filter((word) => word.length > 0);

    // If we don't have enough words for even one chunk, return the entire text as a single chunk
    if (words && words.length <= chunkSize) {
      return [text? words.join(' ') : ''];
    }

    const chunks: string[] = [];
    let startIndex = 0;

    while (words && startIndex < words.length) {
      // Calculate end index for this chunk (ensuring we don't go past the end of the array)
      const endIndex = Math.min(startIndex + chunkSize, words.length);

      // Extract the words for this chunk and join them back into text
      const chunkWords = words.slice(startIndex, endIndex);
      const chunk = chunkWords.join(' ');

      // Add this chunk to our results
      chunks.push(chunk);

      // Move the start index forward by (chunkSize - overlapSize) to create the overlap
      // This means we keep the last overlapSize words from the previous chunk
      startIndex += chunkSize - overlapSize;

      // If we won't have enough new words for the next chunk, break
      // This prevents creating a chunk that would be fully contained in the previous chunk
      if (startIndex + (chunkSize - overlapSize) > words.length) {
        // If we still have a significant number of new words, create one final chunk
        if (words.length - startIndex > overlapSize) {
          chunks.push(words.slice(startIndex - overlapSize).join(' '));
        }
        break;
      }
    }

    return chunks;
  }

  async getFilePath(id: string, userId: string): Promise<string> {
    console.log(`Retrieving file path for file ID: ${id} for user: ${userId}`);

    try {
      const file = await this.fileRepository.findOne({
        where: { id },
        relations: ['folder'],
      });

      if (!file) {
        console.error(`File with ID ${id} not found in database`);
        throw new NotFoundException(`File with ID ${id} not found`);
      }

      console.log(`Found file: ${file.filename}`);

      // If file is in a folder, build the folder path
      let folderPath = 'Home Folder';
      if (file.folder && file.folder.id) {
        try {
          console.log(
            `File is in folder: ${file.folder.id}, fetching folder info`,
          );
          const folder = await this.fileRepository.manager.findOne(Folder, {
            where: { id: file.folder.id },
            relations: ['parent'],
          });

          if (folder) {
            console.log(`Found folder: ${folder.name}`);
            // If folder has a parent, we need to build the full path
            if (folder.parent) {
              const getParentPath = async (
                currentFolder: Folder,
              ): Promise<string> => {
                if (!currentFolder.parent) {
                  // Truncate folder name
                  return this.truncateString(currentFolder.name);
                }

                const parent = (await this.fileRepository.manager.findOne(
                  Folder,
                  {
                    where: { id: currentFolder.parent.id },
                    relations: ['parent'],
                  },
                )) as Folder;

                if (parent) {
                  // Truncate current folder name before adding to path
                  const truncatedFolderName = this.truncateString(
                    currentFolder.name,
                  );
                  return `${await getParentPath(parent)}/${truncatedFolderName}`;
                }

                return this.truncateString(currentFolder.name);
              };

              folderPath = await getParentPath(folder);
            } else {
              // Truncate folder name if it's a top-level folder
              folderPath = this.truncateString(folder.name);
            }
          }
        } catch (error: unknown) {
          let errorMessage = 'Unknown error while getting folder path';
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
          console.error('Error getting folder path:', errorMessage);
        }
      }

      const truncatedFileName = this.truncateString(file.filename, 80);

      return `${folderPath}/${truncatedFileName}`;

    } catch (error: unknown) {
      let errorMessage = `Unknown error getting file path for ${id}`;
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
      console.error(errorMessage);
      throw error; // Re-throw to be handled by the controller
    }
  }

  /**
   * Get the full path for a file in the format: CourseName/FolderName/FileName
   */
  /**
   * Helper function to truncate a string to a maximum length while preserving context
   * @param str String to truncate
   * @param maxLength Maximum length of the resulting string
   * @returns Truncated string
   */
  private truncateString(str: string, maxLength: number = 25): string {
    if (!str || str.length <= maxLength) return str;

    // If string is longer than max length, truncate it and add ellipsis
    // Keep first part (for context) and truncate the middle if needed
    const truncated = str.substring(0, maxLength - 3) + '...';
    return truncated;
  }

  async save(file: File): Promise<void> {
    await this.fileRepository.save(file);
  }

  async saveExtractedContent(
    session: ChatSession,   
    sessionId: string,
    userId: string,
    extractedContent: Array<{
      fileId: string;
      name: string;
      content: string;
    }>,
  ): Promise<ExtractedContent[]> {
    const savedExtractedContentArray: ExtractedContent[] = [];
    for (const content of extractedContent) {
      const savedExtractedContent = await this.extractedContentRepository.save({
        sessionId,
        session,
        fileId: content.fileId,
        fileName: content.name,
        userId,
        text: content.content,
      })
      savedExtractedContentArray.push(savedExtractedContent);
    }

    return savedExtractedContentArray
  }
}
