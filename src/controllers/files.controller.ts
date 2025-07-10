import { 
  Controller, 
  Post, 
  Get, 
  Delete, 
  Param, 
  UseGuards, 
  Req, 
  Res, 
  UseInterceptors, 
  UploadedFile,
  Body,
  Query,
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
    @Body('folderId') folderId?: string,
  ) {
    console.log('Backend: File upload request received');
    console.log('Backend: File details:', {
      originalname: file?.originalname,
      mimetype: file?.mimetype,
      size: file?.size,
      userId: req.user?.userId,
      folderId
    });
    
    const result = await this.fileService.uploadFile(req.user.userId, file, folderId);
    
    console.log('Backend: Upload result:', {
      id: result.id,
      originalName: result.originalName,
      storage_path: result.storage_path,
      mime_type: result.mime_type,
      size_bytes: result.size_bytes
    });
    
    return result;
  }

  @Get('pdf-proxy')
  async pdfProxy(
    @Query('url') url: string,
    @Res() res: Response,
  ) {
    try {
      console.log('Backend: PDF proxy request for URL:', url);
      
      // Import axios
      const axios = await import('axios');
      
      // Fetch the PDF from Google Cloud Storage
      const response = await axios.default.get(url, {
        responseType: 'stream',
      });
      
      // Set appropriate headers
      res.set({
        'Content-Type': 'application/pdf',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      
      // Pipe the response
      response.data.pipe(res);
    } catch (error) {
      console.error('Backend: PDF proxy error:', error);
      res.status(500).json({ error: 'Failed to proxy PDF' });
    }
  }

  @Delete(':id')
  async deleteFile(
    @Req() req: Request & { user: any },
    @Param('id') fileId: string,
  ) {
    await this.fileService.deleteFile(req.user.userId, fileId);
    return { message: 'File deleted successfully' };
  }

  /**
   * Save extracted text from PDF.js Express
   */
  @Post(':id/save-text')
  async saveExtractedText(
    @Req() req: Request & { user: any },
    @Param('id') id: string,
    @Body () textData: { textByPages: string }
  ) {
    try {
      console.log('Backend: Received text extraction request for file:', id);
      console.log('Backend: User ID:', req.user.userId);
      console.log('Backend: Text data length:', textData.textByPages?.length || 0);
      
      const result = await this.fileService.saveExtractedText(
        id,
        req.user.userId,
        textData.textByPages
      );
      
      console.log('Backend: Text extraction saved successfully for file:', result.id);
      return {
        success: true,
        paperUpdated: result.id,
        textLength: textData.textByPages?.length || 0
      };
    } catch (error) {
      console.error('Backend: Error saving extracted text:', error);
      throw error;
    }
  }

  @Get()
  async getFiles(
    @Req() req: Request & { user: any },
    @Query('folderId') folderId?: string,
  ) {
    if (folderId) {
      return this.fileService.getFilesByFolderId(req.user.userId, folderId);
    } else {
      return this.fileService.getAllUserFiles(req.user.userId);
    }
  }

  @Get(':id')
  async getFile(
    @Req() req: Request & { user: any },
    @Param('id') fileId: string,
  ) {
    console.log(`Backend: Getting file ${fileId} for user ${req.user.userId}`);
    const result = await this.fileService.getFileById(req.user.userId, fileId);
    console.log('Backend: File details retrieved:', {
      id: result.id,
      originalName: result.originalName,
      storage_path: result.storage_path,
      mime_type: result.mime_type,
      textExtracted: result.textExtracted,
      processed: result.processed
    });
    return result;
  }
}
