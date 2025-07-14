import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class IPWhitelistService {
  private readonly logger = new Logger(IPWhitelistService.name);
  
  constructor(private configService: ConfigService) {}

  private readonly defaultAllowedIPs = [
    '34.194.127.46',
    '54.234.237.108',
    '3.208.120.145',
    '44.226.236.210',
    '44.241.183.62',
    '100.20.172.113',
  ];

  getAllowedIPs(): string[] {
    const allowedIPsEnv = this.configService.get('ALLOWED_IPS');
    
    if (allowedIPsEnv) {
      const ips = allowedIPsEnv.split(',').map((ip: string) => ip.trim()).filter(Boolean);
      this.logger.log(`Using environment IPs: ${ips.join(', ')}`);
      return ips;
    }
    
    this.logger.log(`Using default IPs: ${this.defaultAllowedIPs.join(', ')}`);
    return this.defaultAllowedIPs;
  }

  isIPAllowed(ip: string): boolean {
    const allowedIPs = this.getAllowedIPs();
    
    // Always allow localhost in development
    if (process.env.NODE_ENV === 'development' && (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost')) {
      return true;
    }
    
    return allowedIPs.includes(ip);
  }

  logAccess(ip: string, allowed: boolean, userAgent?: string): void {
    const status = allowed ? 'ALLOWED' : 'DENIED';
    this.logger.log(`IP Access ${status}: ${ip} ${userAgent ? `- ${userAgent}` : ''}`);
    
    if (!allowed) {
      this.logger.warn(`Blocked access from IP: ${ip}. Allowed IPs: ${this.getAllowedIPs().join(', ')}`);
    }
  }
}
