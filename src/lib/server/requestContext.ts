import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId: string;
  prismaQueryCount: number;
  startedAt: number;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Run a function within a request context
 */
export function runWithRequestContext<T>(
  requestId: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const context: RequestContext = {
    requestId,
    prismaQueryCount: 0,
    startedAt,
  };
  return requestContextStorage.run(context, fn);
}

/**
 * Get the current request context
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Increment the Prisma query count for the current request
 */
export function bumpPrismaQueryCount(): void {
  const context = getRequestContext();
  if (context) {
    context.prismaQueryCount++;
  }
}

