import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Folder } from '../entities/folder.entity';
import { CreateFolderDto } from '../dto/folder.dto';

@Injectable()
export class FolderService {
  constructor(
    @InjectRepository(Folder)
    private folderRepository: Repository<Folder>,
  ) {}

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
    const whereCondition: any = { owner_id: userId };
    
    if (parentId) {
      whereCondition.parent_id = parentId;
    } else {
      whereCondition.parent_id = null;
    }

    const folders = await this.folderRepository.find({
      where: whereCondition,
      relations: ['files'],
    });

    // Get files for this folder level
    const files = folders.length > 0 ? folders[0].files || [] : [];

    return { folders, files };
  }

  async deleteFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.folderRepository.findOne({
      where: { id: folderId, owner_id: userId },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    await this.folderRepository.remove(folder);
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
