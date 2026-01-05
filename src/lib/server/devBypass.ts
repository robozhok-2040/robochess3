/**
 * Dev bypass helpers for localhost development authentication
 * Used consistently across API routes that require coach/admin auth
 */

/**
 * Check if hostname is localhost (various formats)
 */
export function isLocalhostHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(normalized);
}

/**
 * Check if dev bypass is allowed based on environment and host
 */
export function canUseDevBypass({
  nodeEnv,
  hostname,
}: {
  nodeEnv: string | undefined;
  hostname: string;
}): boolean {
  return nodeEnv === 'development' && isLocalhostHost(hostname);
}

/**
 * Parse student ID from potentially composite rowId
 * Handles cases where UI might send composite keys like "studentId:platform" or "studentId__platform"
 * Returns the UUID part (first segment) or null if invalid
 */
export function parseStudentId(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // UUID regex pattern
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // If it contains separators (':', '__', '|'), extract the first part
  if (input.includes(':') || input.includes('__') || input.includes('|')) {
    // Split by common separators and take the first token
    const separators = /[:|]|__/;
    const parts = input.split(separators);
    const candidate = parts[0]?.trim();
    
    if (candidate && candidate.length === 36 && uuidRegex.test(candidate)) {
      return candidate;
    }
    return null;
  }

  // If it's already a UUID, validate it
  if (input.length === 36 && uuidRegex.test(input)) {
    return input;
  }

  return null;
}

/**
 * Normalize platform string to canonical value ('lichess' or 'chesscom')
 * Accepts variations: 'Chess.com', 'chess.com', 'chesscom', 'chess_com', etc.
 * Returns canonical platform or null if invalid
 */
export function normalizePlatform(input: string | null | undefined): 'lichess' | 'chesscom' | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const normalized = input.toLowerCase().trim();

  // Lichess variants
  if (normalized === 'lichess' || normalized === 'lichess.org') {
    return 'lichess';
  }

  // Chess.com variants
  if (normalized === 'chesscom' || 
      normalized === 'chess.com' || 
      normalized === 'chess_com' ||
      normalized === 'chess-com' ||
      normalized === 'chesscom.org' ||
      normalized === 'chess.com/player') {
    return 'chesscom';
  }

  return null;
}

/**
 * Normalize username for a platform (case-insensitive for Lichess and Chess.com)
 * Returns lowercase trimmed username
 */
export function normalizeUsername(platform: 'lichess' | 'chesscom', username: string | null | undefined): string | null {
  if (!username || typeof username !== 'string') {
    return null;
  }

  // Both Lichess and Chess.com usernames are case-insensitive
  // Store in lowercase for consistent matching
  return username.trim().toLowerCase();
}

/**
 * Extract hostname from NextRequest
 * Handles x-forwarded-host header and URL parsing
 */
export function extractHostname(request: { headers: Headers; url: string }): string {
  const hostnameHeader = request.headers.get('x-forwarded-host');
  const urlHostname = new URL(request.url).hostname;
  const hostname = hostnameHeader ? hostnameHeader.split(':')[0] : urlHostname;
  return hostname.toLowerCase();
}

/**
 * Get dev coach ID from request (multiple sources, priority order)
 * 1. Header: "x-dev-coach-id"
 * 2. Cookie: "dev_coach_id"
 * 3. Query param: "devCoachId"
 * 4. Fallback: process.env.DEV_COACH_ID
 */
export function getDevCoachIdFromRequest(request: { headers: Headers; url: string; cookies?: any }): string | null {
  // 1. Header
  const headerId = request.headers.get('x-dev-coach-id');
  if (headerId) return headerId;

  // 2. Cookie (if available)
  if (request.cookies) {
    const cookieId = request.cookies.get('dev_coach_id')?.value;
    if (cookieId) return cookieId;
  }

  // 3. Query param
  try {
    const url = new URL(request.url);
    const queryId = url.searchParams.get('devCoachId');
    if (queryId) return queryId;
  } catch {}

  // 4. Env fallback
  return process.env.DEV_COACH_ID || null;
}

/**
 * Get actor coach (authenticated user or dev bypass)
 * Returns { actorCoachId: string, actorRole: 'coach' | 'admin', mode: 'auth' | 'dev-header' | 'dev-env' }
 * or throws error response object { status, error }
 * 
 * Uses shared coachContext utilities for consistency
 */
export async function getActorCoach(
  request: { headers: Headers; url: string; cookies?: any },
  supabase: any,
  prisma?: any
): Promise<{ actorCoachId: string; actorRole: 'coach' | 'admin'; mode: 'auth' | 'dev-header' | 'dev-env' }> {
  // Use shared coachContext for consistent resolution
  const { resolveCoachId } = await import("@/lib/server/coachContext");
  
  // Try authenticated user first
  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData?.user;

  try {
    const result = await resolveCoachId(request, authUser?.id || null, supabase);
    // Map to expected return shape
    return {
      actorCoachId: result.coachId,
      actorRole: result.role,
      mode: result.mode,
    };
  } catch (err: any) {
    // Re-throw with same format
    throw err;
  }
}

/**
 * Resolve coach actor (authenticated user or dev bypass) - legacy alias for backwards compatibility
 * @deprecated Use getActorCoach instead
 */
export async function resolveCoachActor(
  request: { headers: Headers; url: string; cookies?: any },
  supabase: any,
  prisma?: any
): Promise<{ actorId: string; actorRole: 'coach' | 'admin' }> {
  const result = await getActorCoach(request, supabase, prisma);
  return { actorId: result.actorCoachId, actorRole: result.actorRole };
}

