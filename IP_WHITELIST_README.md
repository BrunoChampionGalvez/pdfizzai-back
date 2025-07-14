# IP Whitelisting Configuration

This application includes IP whitelisting functionality to restrict access to specific IP addresses.

## Configuration

### Environment Variables

Add the following to your `.env` file:

```bash
# IP Whitelist Configuration (comma-separated list)
# Leave empty to use default hardcoded IPs
ALLOWED_IPS=34.194.127.46,54.234.237.108,3.208.120.145,44.226.236.210,44.241.183.62,100.20.172.113
```

### Default Allowed IPs

If no `ALLOWED_IPS` environment variable is set, the following IPs are allowed by default:
- 34.194.127.46
- 54.234.237.108
- 3.208.120.145
- 44.226.236.210
- 44.241.183.62
- 100.20.172.113

### Development Mode

In development mode (`NODE_ENV=development`), the IP whitelist is disabled to allow local development.

## Features

1. **Configurable IP Lists**: Use environment variables or defaults
2. **Detailed Logging**: All access attempts are logged with IP, user agent, and status
3. **Development Mode**: Automatic bypass in development
4. **Route-Level Bypass**: Use `@SkipIpWhitelist()` decorator to skip IP checking for specific routes
5. **Multiple IP Detection**: Handles various proxy headers (`x-forwarded-for`, `x-real-ip`, etc.)

## Usage

### Basic Usage
The IP whitelist is automatically applied to all routes via middleware.

### Skipping IP Whitelist for Specific Routes
```typescript
import { SkipIpWhitelist } from '../decorators/skip-ip-whitelist.decorator';

@Controller('api/public')
export class PublicController {
  @Get('health')
  @SkipIpWhitelist() // This route will bypass IP whitelisting
  healthCheck() {
    return { status: 'ok' };
  }
}
```

## Security Considerations

1. **Production Environment**: Ensure `NODE_ENV=production` in production to enable IP whitelisting
2. **Proxy Configuration**: Make sure your reverse proxy (nginx, CloudFlare, etc.) passes the real client IP
3. **Regular Updates**: Update the IP whitelist as needed via environment variables
4. **Monitoring**: Check logs regularly for unauthorized access attempts

## Troubleshooting

1. **Access Denied**: Check if your IP is in the whitelist and correctly formatted
2. **Development Issues**: Ensure `NODE_ENV=development` for local development
3. **Proxy Issues**: Verify that real client IPs are being passed through proxy headers
4. **Log Monitoring**: Check application logs for detailed access information
