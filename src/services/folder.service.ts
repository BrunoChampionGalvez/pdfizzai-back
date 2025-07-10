import { Injectable, ForbiddenException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Folder } from '../entities/folder.entity';
import { CreateFolderDto } from '../dto/folder.dto';
import { File } from 'src/entities';
import { FileService } from './file.service';

@Injectable()
export class FolderService {
  constructor(
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @Inject(forwardRef(() => FileService))
    private fileService: FileService,
  ) {}

  /**
   * Recursively find all files within a folder and its subfolders
   * @param folderId ID of the parent folder
   * @param userId ID of the user making the request
   * @returns Promise with array of all files in the folder and its subfolders
   */
  async findAllFilesRecursively(
    folderId: string,
    userId: string,
  ): Promise<File[]> {
    // Verify folder exists and belongs to user
    await this.findOne(folderId, userId);

    // Store all files in this result array
    let allFiles: File[] = [];

    // Get files directly in this folder
    const filesInFolder = await this.fileRepository.find({
      where: { folder_id: folderId },
      order: { created_at: 'DESC' },
    });

    // Add files to result
    allFiles = [...filesInFolder];

    // Get all subfolders
    const subfolders = await this.folderRepository.find({
      where: { parent_id: folderId },
    });

    // Recursively get files from each subfolder
    for (const subfolder of subfolders) {
      const subfolderFiles = await this.findAllFilesRecursively(
        subfolder.id,
        userId,
      );
      allFiles = [...allFiles, ...subfolderFiles];
    }

    return allFiles;
  }

  async findOne(id: string, userId: string): Promise<Folder> {
    const folder = await this.folderRepository.findOne({
      where: { id },
    });

    if (!folder) {
      throw new NotFoundException(`Folder with ID ${id} not found`);
    }

    return folder;
  }

  async createFolder(userId: string, createFolderDto: CreateFolderDto): Promise<Folder> {
    const { name, parentId } = createFolderDto;

    // If parentId is provided, verify it belongs to the user
    if (parentId) {
      const parentFolder = await this.folderRepository.findOne({
        where: { id: parentId, owner_id: userId },
      });
      if (!parentFolder) {
        throw new ForbiddenException('Parent folder not found or access denied');
      }
    }

    const folder = this.folderRepository.create({
      name,
      parent_id: parentId,
      owner_id: userId,
    });

    return this.folderRepository.save(folder);
  }

  async getFolders(userId: string, parentId?: string): Promise<{ folders: Folder[]; files: any[] }> {
    // Get ALL folders for the user (for hierarchical tree display)
    const folders = await this.folderRepository.find({
      where: { owner_id: userId },
      order: { name: 'ASC' },
    });

    // Get files for the specific folder level
    let files: any[] = [];
    if (parentId) {
      // Get files in the specified folder
      files = await this.fileRepository.find({
        where: { folder_id: parentId },
        order: { created_at: 'DESC' },
      });
    } else {
      // Get files in root (no folder) - use IsNull for proper null handling
      files = await this.fileRepository.find({
        where: { folder_id: IsNull() },
        order: { created_at: 'DESC' },
      });
    }

    return { folders, files };
  }

  async getAllUserFolders(userId: string): Promise<Folder[]> {
    return this.folderRepository.find({
      where: { owner_id: userId },
      select: ['id', 'name', 'parent_id'],
      order: { name: 'ASC' },
    });
  }

  async deleteFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.folderRepository.findOne({
      where: { id: folderId, owner_id: userId },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    // Recursively delete all contents of the folder
    await this.deleteFolderRecursively(folderId, userId);
  }

  /**
   * Recursively deletes a folder and all its contents (files and subfolders)
   * @param folderId ID of the folder to delete
   * @param userId ID of the user (for permission checking)
   */
  private async deleteFolderRecursively(folderId: string, userId: string): Promise<void> {
    // First, get all child folders
    const childFolders = await this.folderRepository.find({
      where: { parent_id: folderId },
    });

    // Recursively delete all child folders first
    for (const childFolder of childFolders) {
      await this.deleteFolderRecursively(childFolder.id, userId);
    }

    // Delete all files in this folder
    const filesInFolder = await this.fileRepository.find({
      where: { folder_id: folderId },
    });

    for (const file of filesInFolder) {
      // Use FileService to properly delete the file (including from storage)
      try {
        await this.fileService.deleteFile(userId, file.id);
      } catch (error) {
        // Log error but continue with deletion process
        console.error(`Error deleting file ${file.id}:`, error);
        // Fallback to just removing from database
        await this.fileRepository.remove(file);
      }
    }

    // Finally, delete the folder itself
    const folder = await this.folderRepository.findOne({
      where: { id: folderId, owner_id: userId },
    });

    if (folder) {
      await this.folderRepository.remove(folder);
    }
  }

  async getFolderById(userId: string, folderId: string): Promise<Folder> {
    const folder = await this.folderRepository.findOne({
      where: { id: folderId, owner_id: userId },
      relations: ['files'],
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    return folder;
  }
}
