/**
 * Shared coach context utilities for consistent CRUD operations
 * Enforces FrozenSpec invariants: roles, ownership, canonical platform, idempotent CRUD
 */

import type { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export type CoachContext = {
  actorCoachId: string;
  actorRole: 'coach' | 'admin';
  mode: 'auth' | 'dev-header' | 'dev-env';
};

type CoachContextCacheEntry = {
  expiresAt: number;
  promise: Promise<CoachContext>;
};

const g = globalThis as { __rcCoachContextCache?: Map<string, CoachContextCacheEntry> };
const COACH_CONTEXT_CACHE_KEY = "__rcCoachContextCache";
if (!g[COACH_CONTEXT_CACHE_KEY]) {
  g[COACH_CONTEXT_CACHE_KEY] = new Map<string, CoachContextCacheEntry>();
}
const coachContextCache = g[COACH_CONTEXT_CACHE_KEY]!;
const COACH_CONTEXT_CACHE_TTL_MS = 2000;

/**
 * Check if request is from localhost development environment
 * Returns true ONLY when NODE_ENV === 'development' AND host is localhost/127.0.0.1
 */
export function isLocalDev(request: NextRequest | { headers: Headers; url: string }): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return false;
  }

  const hostnameHeader = request.headers.get('x-forwarded-host');
  const urlHostname = new URL(request.url).hostname;
  const hostname = hostnameHeader ? hostnameHeader.split(':')[0] : urlHostname;
  const normalizedHostname = hostname.toLowerCase();

  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(normalizedHostname);
}

/**
 * Resolve coach ID with dev bypass support
 * In localhost dev: allows x-dev-coach-id header OR DEV_COACH_ID env
 * In production: ignores dev headers/env and requires normal auth
 */
export async function resolveCoachId(
  request: NextRequest | { headers: Headers; url: string },
  authedUserId: string | null | undefined,
  supabase: any
): Promise<{ coachId: string; role: 'coach' | 'admin'; mode: 'auth' | 'dev-header' | 'dev-env' }> {
  const localDev = isLocalDev(request);

  // If we have an authenticated user, use it (even in local dev, auth takes precedence)
  if (authedUserId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", authedUserId)
      .maybeSingle();

    if (profile && (profile.role === 'coach' || profile.role === 'admin')) {
      return { coachId: profile.id, role: profile.role as 'coach' | 'admin', mode: 'auth' };
    }
  }

  // In localhost dev, allow dev bypass
  if (localDev) {
    const headerId = request.headers.get('x-dev-coach-id');
    const envId = process.env.DEV_COACH_ID;

    let devCoachId: string | null = null;
    let mode: 'dev-header' | 'dev-env' = 'dev-env';

    if (headerId) {
      devCoachId = headerId;
      mode = 'dev-header';
    } else if (envId) {
      devCoachId = envId;
      mode = 'dev-env';
    }

    if (devCoachId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", devCoachId)
        .maybeSingle();

      if (profile && (profile.role === 'coach' || profile.role === 'admin')) {
        console.warn(`[COACH CONTEXT] Using dev coach: ${profile.id} (role: ${profile.role}, mode: ${mode})`);
        return { coachId: profile.id, role: profile.role as 'coach' | 'admin', mode };
      }
    }
  }

  // Production or no valid dev bypass: require auth
  throw { status: 401, error: "Unauthorized. Sign in as coach/admin, or in local dev provide x-dev-coach-id or set DEV_COACH_ID." };
}

export async function getCoachContext(
  request: NextRequest | { headers: Headers; url: string }
): Promise<CoachContext> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData?.user;

  const result = await resolveCoachId(request, authUser?.id || null, supabase);
  return {
    actorCoachId: result.coachId,
    actorRole: result.role,
    mode: result.mode,
  };
}

function getCoachContextCacheKey(request: NextRequest | { headers: Headers; url: string }): string {
  const devHeader = request.headers.get('x-dev-coach-id');
  if (devHeader) {
    return `dev-header:${devHeader}`;
  }

  const devEnv = process.env.DEV_COACH_ID;
  if (devEnv) {
    return `dev-env:${devEnv}`;
  }

  const cookie = request.headers.get('cookie');
  if (cookie) {
    return `cookie:${cookie}`;
  }

  const authorization = request.headers.get('authorization');
  if (authorization) {
    return `authorization:${authorization}`;
  }

  return 'anon';
}

export async function getCoachContextCached(
  request: NextRequest | { headers: Headers; url: string }
): Promise<CoachContext> {
  const cacheEnabled = process.env.NODE_ENV !== 'production';
  if (!cacheEnabled) {
    return await getCoachContext(request);
  }

  const cacheKey = getCoachContextCacheKey(request);
  const now = Date.now();
  const cached = coachContextCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return cached.promise;
  }

  const promise = getCoachContext(request).catch((error) => {
    coachContextCache.delete(cacheKey);
    throw error;
  });

  coachContextCache.set(cacheKey, { expiresAt: now + COACH_CONTEXT_CACHE_TTL_MS, promise });
  return promise;
}

/**
 * Normalize platform to canonical value ('lichess' or 'chesscom')
 * Enforces FrozenSpec: platform_connections.platform ∈ {'lichess','chesscom'}
 */
export function normalizePlatform(input: string | null | undefined): 'lichess' | 'chesscom' {
  if (!input || typeof input !== 'string') {
    throw { status: 400, error: "Missing or invalid platform (must be 'lichess' or 'chesscom')" };
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

  throw { status: 400, error: `Invalid platform: ${input} (must be 'lichess' or 'chesscom')` };
}

/**
 * Normalize username for a platform (case-insensitive for Lichess and Chess.com)
 * Returns lowercase trimmed username for consistent matching/uniqueness
 */
export function normalizeUsername(platform: 'lichess' | 'chesscom', username: string | null | undefined): string {
  if (!username || typeof username !== 'string') {
    throw { status: 400, error: "Missing or invalid username" };
  }

  // Both Lichess and Chess.com usernames are case-insensitive
  // Store in lowercase for consistent matching
  const normalized = username.trim().toLowerCase();
  
  if (!normalized) {
    throw { status: 400, error: "Username cannot be empty" };
  }

  return normalized;
}

