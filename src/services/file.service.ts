import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { File } from '../entities/file.entity';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FileService {
  private readonly uploadPath = path.join(process.cwd(), 'uploads');

  constructor(
    @InjectRepository(File)
    private fileRepository: Repository<File>,
  ) {
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadPath)) {
      fs.mkdirSync(this.uploadPath, { recursive: true });
    }
  }

  async uploadFile(
    userId: string,
    file: Express.Multer.File,
    folderId?: string,
  ): Promise<File> {
    // Generate unique filename
    const fileExtension = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExtension}`;
    const filePath = path.join(this.uploadPath, fileName);

    // Save file to disk
    fs.writeFileSync(filePath, file.buffer);

    // Create file record
    const fileEntity = this.fileRepository.create({
      filename: file.originalname,
      mime_type: file.mimetype,
      size_bytes: file.size,
      folder_id: folderId,
      owner_id: userId,
      storage_path: filePath,
    });

    return this.fileRepository.save(fileEntity);
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
    const file = await this.fileRepository.findOne({
      where: { id: fileId, owner_id: userId },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Delete file from disk
    if (fs.existsSync(file.storage_path)) {
      fs.unlinkSync(file.storage_path);
    }

    // Delete file record
    await this.fileRepository.remove(file);
  }

  async getFileStream(userId: string, fileId: string): Promise<{ stream: fs.ReadStream; file: File }> {
    const file = await this.getFileById(userId, fileId);
    
    if (!fs.existsSync(file.storage_path)) {
      throw new NotFoundException('File not found on disk');
    }

    const stream = fs.createReadStream(file.storage_path);
    return { stream, file };
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
}
