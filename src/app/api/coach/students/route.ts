import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { runWithRequestContext, getRequestContext } from "@/lib/server/requestContext";
// Import to register Prisma query counter middleware
import "@/lib/server/prismaQueryCounter";

export const dynamic = 'force-dynamic';

export const revalidate = 0; // Disable cache to show fresh DB data immediately

// In-memory anti-storm cache (TTL 2000ms)
type CachePayload = { body: string; status: number };
type CacheEntry = { expiresAt: number; promise: Promise<CachePayload> };

const g = globalThis as any;
const CACHE_KEY = '__rcCoachStudentsCache';
if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map<string, CacheEntry>();
const cache: Map<string, CacheEntry> = g[CACHE_KEY];

const CACHE_TTL_MS = 2000;

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const searchParams = request.nextUrl.searchParams;
  const debug = searchParams.get('debug') === '1';
  const debugEnabled = debug;
  const cacheEnabled = process.env.NODE_ENV !== 'production';

  // Pipeline function that performs the actual work
  // Returns a plain object payload, not NextResponse
  async function executePipeline(): Promise<{ data: any; status: number }> {
    return await runWithRequestContext(requestId, async () => {
      const context = getRequestContext()!;
      let responseStatus = 200;
      let responseData: any = null;
      
      // Stage-level timing breakdown
      const timings: Record<string, number> = {};
      const counts: Record<string, number> = {};
      
      async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
        const t0 = Date.now();
        const res = await fn();
        timings[label] = Date.now() - t0;
        return res;
      }

      try {
    const supabase = await createClient();

    // Resolve actor (coach/admin) - unified helper handles auth + dev bypass
    // This ensures list and delete use the same ownership rules
        let actorCoachId: string = '';
        let actorRole: 'coach' | 'admin' = 'coach';
    try {
          const actorResult = await timed('auth', async () => {
      const { getActorCoach } = await import("@/lib/server/devBypass");
            return await getActorCoach(request, supabase);
          });
          actorCoachId = actorResult.actorCoachId;
          actorRole = actorResult.actorRole;
    } catch (err: any) {
          // Log instrumentation for auth errors
          const durationMs = Date.now() - context.startedAt;
          console.log(`[COACH_STUDENTS] id=${context.requestId} status=${err.status || 401} ms=${durationMs} sql=${context.prismaQueryCount}`);
          
          const errorResponse: any = { error: err.error || "Unauthorized" };
          if (debug) {
            errorResponse.debug = {
              requestId: context.requestId,
              durationMs,
              prismaQueryCount: context.prismaQueryCount,
            };
          }
          
          return { data: errorResponse, status: err.status || 401 };
    }

    // Build where clause: filter by ownership for coaches
    const whereClause: any = { role: "student" };
    if (actorRole === 'coach') {
      // Coach can only see students they added
      whereClause.added_by_coach_id = actorCoachId;
    }
    // Admin can see all students (no additional filter)

        // Query 1: Fetch students WITHOUT any includes (to avoid fetching full history)
        const students = await timed('loadStudents', async () => {
          return await prisma.profiles.findMany({
      where: whereClause,
            select: {
              id: true,
              username: true,
              full_name: true,
              avatar_url: true,
      },
    });
        });
        
        counts.students = students.length;

        const studentIds = students.map(s => s.id);
        if (studentIds.length === 0) {
          // Log instrumentation for empty result
          const durationMs = Date.now() - context.startedAt;
          console.log(`[COACH_STUDENTS] id=${context.requestId} status=200 ms=${durationMs} sql=${context.prismaQueryCount}`);
          
          const emptyResponse: any = [];
          if (debug) {
            const emptyTimings: Record<string, number> = {};
            const emptyCounts: Record<string, number> = { students: 0 };
            emptyResponse.debug = {
              requestId: context.requestId,
              durationMs,
              prismaQueryCount: context.prismaQueryCount,
              timings: emptyTimings,
              counts: emptyCounts,
            };
          }
          
          return { data: emptyResponse, status: 200 };
        }

        // Query 2: Fetch platform connections for all students in ONE query
        const platformConnections = await timed('loadPlatformConnections', async () => {
          return await prisma.platform_connections.findMany({
                  where: {
              user_id: { in: studentIds },
            },
          });
        });
        
        counts.platformConnections = platformConnections.length;

        // Group connections by user_id for easy lookup
        const connectionsByStudentId = new Map<string, typeof platformConnections>();
        for (const conn of platformConnections) {
          if (!connectionsByStudentId.has(conn.user_id)) {
            connectionsByStudentId.set(conn.user_id, []);
          }
          connectionsByStudentId.get(conn.user_id)!.push(conn);
        }

        // Collect platforms for v2 queries
        const v2Platforms = new Set<string>();
        for (const conn of platformConnections) {
          if (conn.platform === 'lichess' || conn.platform === 'chesscom') {
            v2Platforms.add(conn.platform);
          }
        }

        // Map: key = `${student_id}:${platform}` -> stat
        const v2ByKey = new Map<string, any>();
        // Map: studentId -> platform -> latest snapshot (for ratings)
        const v2SnapshotMap = new Map<string, Map<string, any>>();
        // Map: user_id -> latest legacy snapshot
        const legacySnapshotMap = new Map<string, any>();

        // Query 3 & 4: Fetch stats and snapshots
        if (studentIds.length > 0 && v2Platforms.size > 0) {
          const platformArray = Array.from(v2Platforms);
          
          // Query 3: Fetch latest player_stats_v2 per (student_id, platform) using DISTINCT ON
          const v2Stats = await timed('loadStatsV2', async () => {
            const v2StatsQuery = Prisma.sql`
              SELECT DISTINCT ON (student_id, platform)
                student_id,
                platform,
                rapid_24h,
                rapid_7d,
                blitz_24h,
                blitz_7d,
                puzzle_total,
                puzzle_24h,
                puzzle_7d,
                rapid_rating_delta_24h,
                rapid_rating_delta_7d,
                blitz_rating_delta_24h,
                blitz_rating_delta_7d,
                computed_at,
                last_update_ok,
                last_update_error_code,
                last_update_attempt_at
              FROM player_stats_v2
              WHERE student_id = ANY(${studentIds}::uuid[])
                AND platform = ANY(${platformArray}::text[])
              ORDER BY student_id, platform, computed_at DESC
            `;

            return await prisma.$queryRaw<Array<{
              student_id: string;
              platform: string;
              rapid_24h: number | null;
              rapid_7d: number | null;
              blitz_24h: number | null;
              blitz_7d: number | null;
              puzzle_total: number | null;
              puzzle_24h: number | null;
              puzzle_7d: number | null;
              rapid_rating_delta_24h: number | null;
              rapid_rating_delta_7d: number | null;
              blitz_rating_delta_24h: number | null;
              blitz_rating_delta_7d: number | null;
              computed_at: Date | null;
              last_update_ok: boolean | null;
              last_update_error_code: string | null;
              last_update_attempt_at: Date | null;
            }>>(v2StatsQuery);
          });
          
          counts.v2Stats = v2Stats.length;

          // Build map: key = `${student_id}:${platform}` -> stat
          for (const stat of v2Stats) {
            v2ByKey.set(`${stat.student_id}:${stat.platform}`, stat);
          }

          // Query 4: Fetch latest stats_snapshots per (user_id, source) using DISTINCT ON for ALL sources
          // This covers both v2 platforms (lichess/chesscom) and legacy platforms
          const allSnapshots = await timed('loadSnapshots', async () => {
            const allSourcesQuery = Prisma.sql`
              SELECT DISTINCT ON (user_id, source)
                user_id,
                source,
                rapid_rating,
                blitz_rating,
                puzzle_rating,
                rapid_24h,
                rapid_7d,
                blitz_24h,
                blitz_7d,
                puzzle_total,
                puzzle_24h,
                puzzle_7d,
                captured_at
              FROM stats_snapshots
              WHERE user_id = ANY(${studentIds}::uuid[])
              ORDER BY user_id, source, captured_at DESC
            `;

            return await prisma.$queryRaw<Array<{
              user_id: string;
              source: string;
              rapid_rating: number | null;
              blitz_rating: number | null;
              puzzle_rating: number | null;
              rapid_24h: number | null;
              rapid_7d: number | null;
              blitz_24h: number | null;
              blitz_7d: number | null;
              puzzle_total: number | null;
              puzzle_24h: number | null;
              puzzle_7d: number | null;
              captured_at: Date;
            }>>(allSourcesQuery);
          });
          
          counts.allSnapshots = allSnapshots.length;

          // Build maps: separate v2 snapshots and legacy snapshots
          await timed('buildMaps', async () => {
            for (const snapshot of allSnapshots) {
              if (snapshot.source === 'lichess' || snapshot.source === 'chesscom') {
                // V2 platform snapshot (for ratings only)
                if (!v2SnapshotMap.has(snapshot.user_id)) {
                  v2SnapshotMap.set(snapshot.user_id, new Map());
                }
                v2SnapshotMap.get(snapshot.user_id)!.set(snapshot.source, {
                  rapid_rating: snapshot.rapid_rating,
                  blitz_rating: snapshot.blitz_rating,
                  puzzle_rating: snapshot.puzzle_rating,
                });
              } else {
                // Legacy platform snapshot (keep only first/latest per user_id)
                if (!legacySnapshotMap.has(snapshot.user_id)) {
                  legacySnapshotMap.set(snapshot.user_id, snapshot);
                }
              }
            }
          });
        } else if (studentIds.length > 0) {
          // If no v2 platforms, still fetch legacy snapshots
          const legacySnapshots = await timed('loadSnapshots', async () => {
            const legacyQuery = Prisma.sql`
              SELECT DISTINCT ON (user_id, source)
                user_id,
                source,
                rapid_rating,
                blitz_rating,
                puzzle_rating,
                rapid_24h,
                rapid_7d,
                blitz_24h,
                blitz_7d,
                puzzle_total,
                puzzle_24h,
                puzzle_7d,
                captured_at
              FROM stats_snapshots
              WHERE user_id = ANY(${studentIds}::uuid[])
                AND source NOT IN ('lichess', 'chesscom')
              ORDER BY user_id, source, captured_at DESC
            `;

            return await prisma.$queryRaw<Array<{
              user_id: string;
              source: string;
              rapid_rating: number | null;
              blitz_rating: number | null;
              puzzle_rating: number | null;
              rapid_24h: number | null;
              rapid_7d: number | null;
              blitz_24h: number | null;
              blitz_7d: number | null;
              puzzle_total: number | null;
              puzzle_24h: number | null;
              puzzle_7d: number | null;
              captured_at: Date;
            }>>(legacyQuery);
          });
          
          counts.legacySnapshots = legacySnapshots.length;

          await timed('buildMaps', async () => {
            for (const snapshot of legacySnapshots) {
              if (!legacySnapshotMap.has(snapshot.user_id)) {
                legacySnapshotMap.set(snapshot.user_id, snapshot);
              }
            }
          });
    }

    // Create one row per platform connection (not per student)
        let staleMarkedCount = 0;
        const formattedStudents = await timed('computeResponse', async () => {
          return students.flatMap((student) => {
      const connections = connectionsByStudentId.get(student.id) || [];
      
      // If no connections, create one row with platform "None"
      if (connections.length === 0) {
        return [{
          id: `${student.id}:None`,
          student_id: student.id, // UUID of student profile (for delete/other operations)
          nickname: student.username || student.full_name || "Unnamed",
          platform: "None",
          platform_username: "",
          avatar_url: student.avatar_url,
          last_active: legacySnapshotMap.get(student.id)?.captured_at || null,
          stats: {
            rapidRating: null,
            blitzRating: null,
            puzzleRating: null,
            rapidGames24h: null,
            rapidGames7d: null,
            blitzGames24h: null,
            blitzGames7d: null,
            puzzles3d: null,
            puzzles7d: null,
            puzzle_total: null,
            rapidRatingDelta24h: null,
            rapidRatingDelta7d: null,
            blitzRatingDelta24h: null,
            blitzRatingDelta7d: null,
          },
        }];
      }

      // Create one row per connection
      return connections.map((connection) => {
        const latestStats = legacySnapshotMap.get(student.id);
        const platform = connection.platform;
        const platformSnapshotMap = v2SnapshotMap.get(student.id);
        
        // Get v2 stats using key lookup (no DB query in loop)
        const key = `${student.id}:${platform}`;
        const v2Stats = platform && (platform === 'lichess' || platform === 'chesscom') 
          ? v2ByKey.get(key) ?? null
          : null;
        // Get platform-specific snapshot for ratings (v2 platforms)
        const v2Snapshot = platform && (platform === 'lichess' || platform === 'chesscom')
          ? platformSnapshotMap?.get(platform)
          : null;

        // Determine stats source (v2 is default for Lichess and Chess.com)
        const isV2Platform = platform === 'lichess' || platform === 'chesscom';
        
        let statsSource: "v2" | "legacy" | "none" = "none";
        let rapidGames24h: number | null = null;
        let rapidGames7d: number | null = null;
        let blitzGames24h: number | null = null;
        let blitzGames7d: number | null = null;
        let puzzleTotal: number | null = null;
        let puzzle24h: number | null = null;
        let puzzle7d: number | null = null;
        let rapidRating: number | null = null;
        let blitzRating: number | null = null;
        let rapidRatingDelta24h: number | null = null;
        let rapidRatingDelta7d: number | null = null;
        let blitzRatingDelta24h: number | null = null;
        let blitzRatingDelta7d: number | null = null;

        // Stats freshness metadata (for lichess/chesscom only)
        let statsComputedAt: string | null = null;
        let lastSyncedAt: string | null = null;
        let statsIsStale = false;
        let statsUpdateOk: boolean | null = null;
        let statsUpdateErrorCode: string | null = null;
        let statsUpdateAttemptAt: string | null = null;

        if (isV2Platform) {
          // For Lichess and Chess.com: use v2 if available, otherwise return null (not 0)
          if (v2Stats) {
            statsSource = "v2";
            // Preserve 0 as 0 (not null) - ?? null already does this correctly, but be explicit
            rapidGames24h = v2Stats.rapid_24h ?? null;
            rapidGames7d = v2Stats.rapid_7d ?? null;
            blitzGames24h = v2Stats.blitz_24h ?? null;
            blitzGames7d = v2Stats.blitz_7d ?? null;
            
            // Puzzle fields from player_stats_v2 (only for lichess/chesscom)
            puzzleTotal = v2Stats.puzzle_total ?? null;
            puzzle24h = v2Stats.puzzle_24h ?? null;
            puzzle7d = v2Stats.puzzle_7d ?? null;
            
            // Rating delta fields from player_stats_v2
            rapidRatingDelta24h = v2Stats.rapid_rating_delta_24h ?? null;
            rapidRatingDelta7d = v2Stats.rapid_rating_delta_7d ?? null;
            blitzRatingDelta24h = v2Stats.blitz_rating_delta_24h ?? null;
            blitzRatingDelta7d = v2Stats.blitz_rating_delta_7d ?? null;
            
            // Ratings from platform-specific snapshot (v2)
            rapidRating = v2Snapshot?.rapid_rating ?? null;
            blitzRating = v2Snapshot?.blitz_rating ?? null;
            
            // Extract computed_at timestamp
            statsComputedAt = v2Stats.computed_at ? new Date(v2Stats.computed_at).toISOString() : null;
            
            // Extract update attempt info
            statsUpdateOk = v2Stats.last_update_ok ?? null;
            statsUpdateErrorCode = v2Stats.last_update_error_code ?? null;
            statsUpdateAttemptAt = v2Stats.last_update_attempt_at ? new Date(v2Stats.last_update_attempt_at).toISOString() : null;
          } else {
            statsSource = "none";
            rapidGames24h = null;
            rapidGames7d = null;
            blitzGames24h = null;
            blitzGames7d = null;
            puzzleTotal = null;
            puzzle24h = null;
            puzzle7d = null;
            rapidRating = null;
            blitzRating = null;
            rapidRatingDelta24h = null;
            rapidRatingDelta7d = null;
            blitzRatingDelta24h = null;
            blitzRatingDelta7d = null;
          }
          
          // Extract last_synced_at from platform connection
          lastSyncedAt = connection.last_synced_at ? new Date(connection.last_synced_at).toISOString() : null;
          
          // Calculate statsIsStale: true if computedAt is null OR older than 2 hours
          if (statsComputedAt === null) {
            statsIsStale = true;
            staleMarkedCount++;
          } else {
            const computedAtMs = new Date(statsComputedAt).getTime();
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
            statsIsStale = computedAtMs < twoHoursAgo;
            if (statsIsStale) {
              staleMarkedCount++;
            }
          }
        } else {
          // For other platforms: use legacy behavior (default to 0)
          statsSource = latestStats ? "legacy" : "none";
          rapidGames24h = latestStats?.rapid_24h ?? 0;
          rapidGames7d = latestStats?.rapid_7d ?? 0;
          blitzGames24h = latestStats?.blitz_24h ?? 0;
          blitzGames7d = latestStats?.blitz_7d ?? 0;
          puzzleTotal = latestStats?.puzzle_total ?? 0;
          puzzle24h = latestStats?.puzzle_24h ?? 0;
          puzzle7d = latestStats?.puzzle_7d ?? 0;
          rapidRating = latestStats?.rapid_rating ?? null;
          blitzRating = latestStats?.blitz_rating ?? null;
        }

        const result: any = {
          id: `${student.id}:${platform}`, // Unique composite key: student_id:platform
          student_id: student.id, // UUID of student profile (for delete/other operations)
          nickname: student.username || student.full_name || "Unnamed",
          platform: platform,
          platform_username: connection.platform_username || "",
          avatar_url: student.avatar_url,
          last_active: latestStats?.captured_at || connection.last_synced_at || null,
          
          stats: {
            // RATINGS (from platform-specific snapshot for v2, legacy snapshot for others)
            rapidRating: rapidRating,
            blitzRating: blitzRating,
            puzzleRating: isV2Platform ? (v2Snapshot?.puzzle_rating ?? null) : (latestStats?.puzzle_rating ?? null),
            
            // 24H/7D STATS (v2 for Lichess and Chess.com returns null when missing, legacy for other platforms defaults to 0)
            rapidGames24h: rapidGames24h,
            rapidGames7d: rapidGames7d,
            blitzGames24h: blitzGames24h,
            blitzGames7d: blitzGames7d,
            
            // PUZZLES (v2 for Lichess and Chess.com, legacy for other platforms)
            puzzles3d: isV2Platform ? puzzle24h : (latestStats?.puzzle_24h ?? 0),
            puzzles7d: isV2Platform ? puzzle7d : (latestStats?.puzzle_7d ?? 0),
            puzzle_total: isV2Platform ? puzzleTotal : (latestStats?.puzzle_total ?? 0),
            
            // RATING DELTAS (v2 for Lichess and Chess.com only, null when missing)
            rapidRatingDelta24h: isV2Platform ? rapidRatingDelta24h : null,
            rapidRatingDelta7d: isV2Platform ? rapidRatingDelta7d : null,
            blitzRatingDelta24h: isV2Platform ? blitzRatingDelta24h : null,
            blitzRatingDelta7d: isV2Platform ? blitzRatingDelta7d : null,
          }
        };

        // Add stats freshness metadata for lichess/chesscom platforms
        if (isV2Platform) {
          result.statsSource = statsSource;
          result.statsComputedAt = statsComputedAt;
          result.lastSyncedAt = lastSyncedAt;
          result.statsIsStale = statsIsStale;
          result.statsUpdateOk = statsUpdateOk;
          result.statsUpdateErrorCode = statsUpdateErrorCode;
          result.statsUpdateAttemptAt = statsUpdateAttemptAt;
        }

        // Add debug field if requested
        if (debug) {
          result.stats_source = statsSource;
        }

            return result;
          });
        });
      });
      
      counts.formattedRows = formattedStudents.length;
      if (staleMarkedCount > 0 && debug) {
        console.log(`[coach/students] [DEBUG] staleMarked=${staleMarkedCount}`);
      }

        // Build response with optional debug field
        const durationMs = Date.now() - context.startedAt;
        
        // Log instrumentation before returning
        console.log(`[COACH_STUDENTS] id=${context.requestId} status=${responseStatus} ms=${durationMs} sql=${context.prismaQueryCount}`);
        
        if (debug) {
          // Wrap response in object with debug field when debug=1
          const responseWithDebug = {
            data: formattedStudents,
            debug: {
              requestId: context.requestId,
              durationMs,
              prismaQueryCount: context.prismaQueryCount,
              timings,
              counts,
            },
          };
          return { data: responseWithDebug, status: 200 };
        }

        return { data: formattedStudents, status: 200 };
      } catch (error) {
        // Error handling: log with stack trace and return 500
        const context = getRequestContext()!;
        responseStatus = 500;
        const durationMs = Date.now() - context.startedAt;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const safeMessage = errorMessage.includes('DATABASE_URL') || errorMessage.includes('password') || errorMessage.includes('secret')
          ? 'Database connection error'
          : errorMessage;
        
        // Log with instrumentation
        console.log(`[COACH_STUDENTS] id=${context.requestId} status=${responseStatus} ms=${durationMs} sql=${context.prismaQueryCount}`);
        console.error(`[COACH_STUDENTS] Error in /api/coach/students:`, safeMessage);
        if (errorStack) {
          console.error(`[COACH_STUDENTS] Stack:`, errorStack);
        }

        // Build error response with optional debug field
        const errorResponse: any = { error: "Internal Server Error" };
        if (debug) {
          errorResponse.debug = {
            requestId: context.requestId,
            durationMs,
            prismaQueryCount: context.prismaQueryCount,
            timings,
            counts,
          };
        }
        
        return { data: errorResponse, status: 500 };
      }
    });
  }

  // Helper to execute pipeline and return NextResponse
  async function executeAndReturnResponse(): Promise<NextResponse> {
    try {
      const payload = await executePipeline();
      const body = JSON.stringify(payload.data);
      return new NextResponse(body, {
        status: payload.status,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      // Outer catch for any errors outside the request context (shouldn't happen, but safety)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const safeMessage = errorMessage.includes('DATABASE_URL') || errorMessage.includes('password') || errorMessage.includes('secret')
        ? 'Database connection error'
        : errorMessage;
      console.error("[COACH_STUDENTS] Fatal error outside request context:", safeMessage);
      if (error instanceof Error && error.stack) {
        console.error("[COACH_STUDENTS] Stack:", error.stack);
      }
      return NextResponse.json(
        { error: "Internal Server Error" },
        { status: 500 }
      );
    }
  }

  // If debug=1, always execute pipeline without cache
  if (debugEnabled) {
    return await executeAndReturnResponse();
  }

  // If cache is disabled (production), always execute pipeline
  if (!cacheEnabled) {
    return await executeAndReturnResponse();
  }

  // For dev mode non-debug requests: use cache
  try {
    // First, resolve coachId for cache key (quick auth check)
    const supabase = await createClient();
    let cacheKey: string;
    try {
      const { getActorCoach } = await import("@/lib/server/devBypass");
      const actor = await getActorCoach(request, supabase);
      cacheKey = `${actor.actorCoachId}:${actor.actorRole}`;
    } catch (err: any) {
      // Auth failed, execute pipeline to return proper error
      return await executeAndReturnResponse();
    }

    // Check cache
    const now = Date.now();
    const cached = cache.get(cacheKey);
    
    if (cached && now < cached.expiresAt) {
      // Cache hit: await cached payload and create NEW NextResponse
      console.log(`[COACH_STUDENTS] cache=HIT id=${requestId} key=${cacheKey}`);
      const cachedPayload = await cached.promise;
      return new NextResponse(cachedPayload.body, {
        status: cachedPayload.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Cache miss or expired: create new cache entry
    const expiresAt = now + CACHE_TTL_MS;
    const promise = executePipeline()
      .then((payload) => {
        // Stringify payload and return cache payload
        const body = JSON.stringify(payload.data);
        return { body, status: payload.status };
      })
      .catch((error) => {
        // On error, remove from cache to avoid poisoning
        cache.delete(cacheKey);
        throw error;
      });
    
    cache.set(cacheKey, { expiresAt, promise });
    
    // Await promise and create NextResponse
    const cachedPayload = await promise;
    return new NextResponse(cachedPayload.body, {
      status: cachedPayload.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    // Outer catch for any errors outside the request context (shouldn't happen, but safety)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const safeMessage = errorMessage.includes('DATABASE_URL') || errorMessage.includes('password') || errorMessage.includes('secret')
      ? 'Database connection error'
      : errorMessage;
    console.error("[COACH_STUDENTS] Fatal error outside request context:", safeMessage);
    if (error instanceof Error && error.stack) {
      console.error("[COACH_STUDENTS] Stack:", error.stack);
    }
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
