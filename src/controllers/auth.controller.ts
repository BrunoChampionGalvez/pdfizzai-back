import { Controller, Post, Get, Body, Res, UseGuards, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from '../services/auth.service';
import { SignupDto, LoginDto } from '../dto/auth.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  async signup(@Body() signupDto: SignupDto, @Res() res: Response) {
    const result = await this.authService.signup(signupDto);
    
    // Set HTTP-only cookie
    res.cookie('access_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      ...(process.env.NODE_ENV === 'production' && { domain: process.env.COOKIE_DOMAIN }),
    });

    return res.json({ user: result.user });
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto, @Res() res: Response) {
    const result = await this.authService.login(loginDto);
    
    // Set HTTP-only cookie
    res.cookie('access_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      ...(process.env.NODE_ENV === 'production' && { domain: process.env.COOKIE_DOMAIN }),
    });

    return res.json({ user: result.user });
  }

  @Post('logout')
  logout(@Res() res: Response) {
    // Clear cookie with the same options used when setting it
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      ...(process.env.NODE_ENV === 'production' && { domain: process.env.COOKIE_DOMAIN }),
    });
    return res.json({ message: 'Logged out successfully' });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: Request & { user: any }) {
    const user = await this.authService.validateUser(req.user.userId);
    return { id: user.id, email: user.email, name: user.name, country: user.country };
  }
}
