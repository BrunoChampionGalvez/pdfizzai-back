// Crypto polyfill for Node.js environments
// This fixes the "crypto is not defined" error in @nestjs/typeorm 11.0.0 with Node.js 18

try {
  let crypto: any;
  
  // Try different import methods for maximum compatibility
  try {
    // Try node:crypto first (Node.js 14.18.0+)
    const cryptoModule = require('node:crypto');
    crypto = cryptoModule.webcrypto || cryptoModule;
  } catch {
    try {
      // Fallback to legacy crypto import
      crypto = require('crypto');
    } catch {
      console.warn('Crypto module not available');
    }
  }

  if (crypto) {
    // Set crypto globally in multiple ways for maximum compatibility
    if (typeof globalThis !== 'undefined' && !globalThis.crypto) {
      (globalThis as any).crypto = crypto;
    }
    
    if (typeof global !== 'undefined' && !(global as any).crypto) {
      (global as any).crypto = crypto;
    }
    
    // Also ensure crypto.randomUUID is available
    if (crypto.randomUUID && typeof globalThis !== 'undefined') {
      if (!globalThis.crypto?.randomUUID) {
        (globalThis as any).crypto = {
          ...(globalThis.crypto || {}),
          randomUUID: crypto.randomUUID.bind(crypto)
        };
      }
    }
  }
  
} catch (error) {
  console.warn('Failed to setup crypto polyfill:', error);
}

export {};