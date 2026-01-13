import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * Get Prisma database URL with automatic connection_limit=1 for Supabase pooler in dev mode
 */
function getPrismaDbUrl(): string {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    return ''
  }

  const isDev = process.env.NODE_ENV !== 'production'

  if (!isDev) {
    // Production: return URL as-is
    return dbUrl
  }

  try {
    const url = new URL(dbUrl)
    const hostname = url.hostname.toLowerCase()
    const searchParams = url.searchParams

    // Check if this is a Supabase pooler connection
    const isPooler =
      hostname.includes('pooler.supabase.com') ||
      searchParams.get('pgbouncer') === 'true'

    if (isPooler && !searchParams.has('connection_limit')) {
      // Force-add connection_limit=1 for pooler in dev
      searchParams.set('connection_limit', '1')
      url.search = searchParams.toString()
      return url.toString()
    }

    return dbUrl
  } catch {
    // If URL parsing fails, return original (let Prisma handle the error)
    return dbUrl
  }
}

// Build log array: always warn/error, add query only if enabled
const logLevels: Array<'warn' | 'error' | 'query'> = ['warn', 'error']
if (process.env.PRISMA_LOG_QUERIES === '1') {
  logLevels.push('query')
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevels,
    datasources: {
      db: {
        url: getPrismaDbUrl(),
      },
    },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma

