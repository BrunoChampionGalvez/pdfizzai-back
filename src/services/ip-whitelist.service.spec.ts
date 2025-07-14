import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IPWhitelistService } from '../services/ip-whitelist.service';

describe('IPWhitelistService', () => {
  let service: IPWhitelistService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IPWhitelistService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<IPWhitelistService>(IPWhitelistService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllowedIPs', () => {
    it('should return default IPs when no environment variable is set', () => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined);
      
      const allowedIPs = service.getAllowedIPs();
      
      expect(allowedIPs).toContain('34.194.127.46');
      expect(allowedIPs).toContain('54.234.237.108');
      expect(allowedIPs).toContain('3.208.120.145');
      expect(allowedIPs).toContain('44.226.236.210');
      expect(allowedIPs).toContain('44.241.183.62');
      expect(allowedIPs).toContain('100.20.172.113');
    });

    it('should return environment IPs when ALLOWED_IPS is set', () => {
      const envIPs = '1.1.1.1,2.2.2.2,3.3.3.3';
      jest.spyOn(configService, 'get').mockReturnValue(envIPs);
      
      const allowedIPs = service.getAllowedIPs();
      
      expect(allowedIPs).toEqual(['1.1.1.1', '2.2.2.2', '3.3.3.3']);
    });
  });

  describe('isIPAllowed', () => {
    it('should allow whitelisted IPs', () => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined);
      
      expect(service.isIPAllowed('34.194.127.46')).toBe(true);
      expect(service.isIPAllowed('54.234.237.108')).toBe(true);
    });

    it('should reject non-whitelisted IPs', () => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined);
      
      expect(service.isIPAllowed('192.168.1.1')).toBe(false);
      expect(service.isIPAllowed('10.0.0.1')).toBe(false);
    });

    it('should allow localhost in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      jest.spyOn(configService, 'get').mockReturnValue(undefined);
      
      expect(service.isIPAllowed('127.0.0.1')).toBe(true);
      expect(service.isIPAllowed('::1')).toBe(true);
      expect(service.isIPAllowed('localhost')).toBe(true);
      
      process.env.NODE_ENV = originalEnv;
    });
  });
});
