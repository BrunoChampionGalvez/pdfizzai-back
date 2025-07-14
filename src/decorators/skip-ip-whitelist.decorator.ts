import { SetMetadata } from '@nestjs/common';

export const SKIP_IP_WHITELIST_KEY = 'skipIpWhitelist';
export const SkipIpWhitelist = () => SetMetadata(SKIP_IP_WHITELIST_KEY, true);
