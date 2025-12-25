import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { prisma } from '@/lib/prisma';
import { safeNdjsonLineParse } from '@/lib/stats/gamesActivityV2';

export const dynamic = 'force-dynamic';

interface LichessGame {
  id?: string;
  speed?: string;
  perf?: string;
  rated?: boolean;
  variant?: string;
  lastMoveAt?: number;
  createdAt?: number;
  [key: string]: unknown;
}

/**
 * Check if user is authorized to access debug endpoint
 * Supports:
 * - Dev bypass (NODE_ENV !== "production")
 * - Debug key (header or query param matching DEBUG_API_KEY)
 * - Coach/admin auth (production only, when no debug key)
 */
async function checkAuth(request: NextRequest): Promise<{ authorized: boolean; error?: string }> {
  // 1. Dev bypass: allow in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    return { authorized: true };
  }

  // 2. Check for debug key override (works in any env)
  const debugKeyHeader = request.headers.get('x-debug-key');
  const searchParams = request.nextUrl.searchParams;
  const debugKeyParam = searchParams.get('debugKey');
  const providedDebugKey = debugKeyHeader || debugKeyParam;

  if (providedDebugKey) {
    const expectedDebugKey = process.env.DEBUG_API_KEY;
    if (expectedDebugKey && providedDebugKey === expectedDebugKey) {
      return { authorized: true };
    }
    // If debug key provided but doesn't match, still reject
    return { authorized: false, error: 'Unauthorized' };
  }

  // 3. Production: require coach/admin auth guard
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { authorized: false, error: 'Unauthorized' };
    }

    // Check user role in profiles table
    const profile = await prisma.profiles.findUnique({
      where: { id: user.id },
      select: { role: true },
    });

    if (!profile || (profile.role !== 'coach' && profile.role !== 'admin')) {
      return { authorized: false, error: 'Unauthorized' };
    }

    return { authorized: true };
  } catch (error) {
    return {
      authorized: false,
      error: 'Unauthorized',
    };
  }
}

export async function GET(request: NextRequest) {
  // Check authorization
  const auth = await checkAuth(request);
  if (!auth.authorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const username = searchParams.get('username');
    const perfTypeParam = searchParams.get('perfType') || 'blitz';
    const daysParam = searchParams.get('days');
    const limitParam = searchParams.get('limit');

    // Validate username
    if (!username || username.trim() === '') {
      return NextResponse.json(
        { ok: false, error: 'username query parameter is required' },
        { status: 400 }
      );
    }

    // Validate perfType
    if (perfTypeParam !== 'rapid' && perfTypeParam !== 'blitz') {
      return NextResponse.json(
        { ok: false, error: 'perfType must be "rapid" or "blitz"' },
        { status: 400 }
      );
    }

    const perfType = perfTypeParam as 'rapid' | 'blitz';

    // Parse days (default 7)
    const days = daysParam ? parseInt(daysParam, 10) : 7;
    if (isNaN(days) || days < 1) {
      return NextResponse.json(
        { ok: false, error: 'days must be a positive integer' },
        { status: 400 }
      );
    }

    // Parse limit (default 20)
    const limit = limitParam ? parseInt(limitParam, 10) : 20;
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        { ok: false, error: 'limit must be between 1 and 100' },
        { status: 400 }
      );
    }

    // Compute sinceMs based on days
    const now = new Date();
    const sinceMs = now.getTime() - days * 24 * 60 * 60 * 1000;

    // Build headers (same as computeFromLichess)
    const headers: Record<string, string> = {
      Accept: 'application/x-ndjson',
      'User-Agent': 'RoboChess/1.0',
    };

    // Add token if present in env (same as computeFromLichess)
    const token = process.env.LICHESS_TOKEN;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Build URL (same as computeFromLichess)
    const url = `https://lichess.org/api/games/user/${username}?since=${sinceMs}&max=400&perfType=${perfType}&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`;

    // Fetch from Lichess
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      return NextResponse.json(
        {
          ok: false,
          error: fetchError instanceof Error ? fetchError.message : 'Fetch failed',
        },
        { status: 500 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Lichess API returned ${response.status} ${response.statusText}`,
          status: response.status,
        },
        { status: response.status }
      );
    }

    // Read and parse NDJSON lines
    const text = await response.text();
    const lines = text.split('\n').filter((line) => line.trim().length > 0);

    // Parse up to limit lines
    const sample: Array<{
      id: string | null;
      speed: string | null;
      perf: string | null;
      rated: boolean | null;
      variant: string | null;
      lastMoveAt: string | null;
      createdAt: string | null;
    }> = [];

    let minLastMoveAt: number | null = null;
    let maxLastMoveAt: number | null = null;

    const linesToProcess = lines.slice(0, limit);
    for (const line of linesToProcess) {
      const game = safeNdjsonLineParse<LichessGame>(line);
      if (game) {
        // Extract fields
        const lastMoveAtMs = typeof game.lastMoveAt === 'number' ? game.lastMoveAt : null;
        const createdAtMs = typeof game.createdAt === 'number' ? game.createdAt : null;

        // Track min/max lastMoveAt
        if (lastMoveAtMs !== null) {
          if (minLastMoveAt === null || lastMoveAtMs < minLastMoveAt) {
            minLastMoveAt = lastMoveAtMs;
          }
          if (maxLastMoveAt === null || lastMoveAtMs > maxLastMoveAt) {
            maxLastMoveAt = lastMoveAtMs;
          }
        }

        sample.push({
          id: typeof game.id === 'string' ? game.id : null,
          speed: typeof game.speed === 'string' ? game.speed : null,
          perf: typeof game.perf === 'string' ? game.perf : null,
          rated: typeof game.rated === 'boolean' ? game.rated : null,
          variant: typeof game.variant === 'string' ? game.variant : null,
          lastMoveAt: lastMoveAtMs !== null ? new Date(lastMoveAtMs).toISOString() : null,
          createdAt: createdAtMs !== null ? new Date(createdAtMs).toISOString() : null,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      username,
      perfType,
      now: now.toISOString(),
      sinceMs,
      fetchedLines: lines.length,
      sample,
      minLastMoveAt: minLastMoveAt !== null ? new Date(minLastMoveAt).toISOString() : null,
      maxLastMoveAt: maxLastMoveAt !== null ? new Date(maxLastMoveAt).toISOString() : null,
    });
  } catch (error) {
    console.error('[debug/lichess-export] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

