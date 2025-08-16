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
    '38.43.130.166',
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
    
    // Allow Vercel deployment IPs (for frontend requests)
    const vercelIPs = [
      '76.76.19.0/24',
      '76.76.21.0/24', 
      '76.223.126.88/29',
      '179.6.0.0/16'  // Your current IP range
    ];
    
    // Check if IP is in any of the Vercel IP ranges
    for (const range of vercelIPs) {
      if (this.isIPInRange(ip, range)) {
        return true;
      }
    }
    
    return allowedIPs.includes(ip);
  }
  
  private isIPInRange(ip: string, range: string): boolean {
    if (!range.includes('/')) {
      return ip === range;
    }
    
    const [network, prefixLength] = range.split('/');
    const networkParts = network.split('.').map(Number);
    const ipParts = ip.split('.').map(Number);
    const prefix = parseInt(prefixLength);
    
    // Convert to 32-bit integers
    const networkInt = (networkParts[0] << 24) + (networkParts[1] << 16) + (networkParts[2] << 8) + networkParts[3];
    const ipInt = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
    
    // Create subnet mask
    const mask = (-1 << (32 - prefix)) >>> 0;
    
    return (networkInt & mask) === (ipInt & mask);
  }

  logAccess(ip: string, allowed: boolean, userAgent?: string): void {
    const status = allowed ? 'ALLOWED' : 'DENIED';
    this.logger.log(`IP Access ${status}: ${ip} ${userAgent ? `- ${userAgent}` : ''}`);
    
    if (!allowed) {
      this.logger.warn(`Blocked access from IP: ${ip}. Allowed IPs: ${this.getAllowedIPs().join(', ')}`);
    }
  }
}
