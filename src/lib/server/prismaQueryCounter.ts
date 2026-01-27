import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { bumpPrismaQueryCount } from './requestContext';

const globalForMiddleware = globalThis as unknown as { prismaQueryCounterRegistered?: boolean };

/**
 * Register Prisma middleware to count queries per request
 * Uses globalThis guard to ensure it's registered only once (even on dev reload)
 */
export function registerPrismaQueryCounter(): void {
  if (globalForMiddleware.prismaQueryCounterRegistered) {
    return; // Already registered
  }

  prisma.$use(async (params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<any>) => {
    // Increment query count for the current request context
    bumpPrismaQueryCount();
    return next(params);
  });

  globalForMiddleware.prismaQueryCounterRegistered = true;
}

// Register middleware immediately when module loads
registerPrismaQueryCounter();



