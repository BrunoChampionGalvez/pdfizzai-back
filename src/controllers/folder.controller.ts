import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { FolderService } from '../services/folder.service';
import { FileService } from '../services/file.service';
import { CreateFolderDto } from '../dto/folder.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('api/folders')
@UseGuards(JwtAuthGuard)
export class FolderController {
  constructor(
    private folderService: FolderService,
    private fileService: FileService,
  ) {}

  @Get()
  async getFolders(
    @Req() req: Request & { user: any },
    @Query('parentId') parentId?: string,
  ) {
    const { folders } = await this.folderService.getFolders(req.user.userId, parentId);
    
    // Get files for the current folder level
    let files;
    if (parentId) {
      files = await this.fileService.getFilesByFolderId(req.user.userId, parentId);
    } else {
      files = await this.fileService.getRootFiles(req.user.userId);
    }

    return { folders, files };
  }

  @Post()
  async createFolder(
    @Req() req: Request & { user: any },
    @Body() createFolderDto: CreateFolderDto,
  ) {
    return this.folderService.createFolder(req.user.userId, createFolderDto);
  }

  @Delete(':id')
  async deleteFolder(
    @Req() req: Request & { user: any },
    @Param('id') folderId: string,
  ) {
    await this.folderService.deleteFolder(req.user.userId, folderId);
    return { message: 'Folder deleted successfully' };
  }
}
