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
  UploadedFile, 
  Body
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
      const result = await this.fileService.saveExtractedText(
        id,
        req.user.userId, // Fixed: using req.user.userId instead of req.user.id
        textData.textByPages
      );
      
      console.log('Backend: Text extraction saved successfully for file:', result.id);
      return {
        success: true,
        paperUpdated: result.id,
        pageCount: Object.keys(textData.textByPages).length
      };
    } catch (error) {
      console.error('Backend: Error saving extracted text:', error);
      throw error;
    }
  }

  @Get(':id')
  async getFileDetails(
    @Req() req: Request & { user: any },
    @Param('id') fileId: string,
  ) {
    console.log('Backend: Getting file details for:', fileId);
    return this.fileService.findOne(fileId);
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

  @Get()
  async getAllFiles(
    @Req() req: Request & { user: any },
  ) {
    return this.fileService.getAllUserFiles(req.user.userId);
  }
}
