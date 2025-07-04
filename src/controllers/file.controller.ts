import { 
  Controller, 
  Post, 
  Get, 
  Delete, 
  Param, 
  Query, 
  UseGuards, 
  Req, 
  Res, 
  UseInterceptors, 
  UploadedFile 
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { FileService } from '../services/file.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('api/files')
@UseGuards(JwtAuthGuard)
export class FileController {
  constructor(private fileService: FileService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Req() req: Request & { user: any },
    @UploadedFile() file: Express.Multer.File,
    @Query('folderId') folderId?: string,
  ) {
    return this.fileService.uploadFile(req.user.userId, file, folderId);
  }

  @Get(':id/download')
  async downloadFile(
    @Req() req: Request & { user: any },
    @Param('id') fileId: string,
    @Res() res: Response,
  ) {
    const { stream, file } = await this.fileService.getFileStream(req.user.userId, fileId);
    
    res.set({
      'Content-Type': file.mime_type,
      'Content-Disposition': `inline; filename="${file.filename}"`,
      'Content-Length': file.size_bytes,
    });

    stream.pipe(res);
  }

  @Delete(':id')
  async deleteFile(
    @Req() req: Request & { user: any },
    @Param('id') fileId: string,
  ) {
    await this.fileService.deleteFile(req.user.userId, fileId);
    return { message: 'File deleted successfully' };
  }
}
