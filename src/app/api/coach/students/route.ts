import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export const revalidate = 0; // Disable cache to show fresh DB data immediately

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const debug = searchParams.get('debug') === '1';

    const students = await prisma.profiles.findMany({
      where: { role: "student" },
      include: {
        platform_connections: true,
        stats_snapshots: {
          orderBy: { captured_at: 'desc' },
          take: 1,
        },
      },
    });

    // Fetch v2 stats for all students with Lichess or Chess.com connections
    const studentsWithV2Platforms = students.filter(s => 
      s.platform_connections.some(c => c.platform === 'lichess' || c.platform === 'chesscom')
    );
    
    // Map: studentId -> platform -> stat
    const v2StatsMap = new Map<string, Map<string, any>>();
    // Map: studentId -> platform -> latest snapshot (for ratings)
    const v2SnapshotMap = new Map<string, Map<string, any>>();
    
    if (studentsWithV2Platforms.length > 0) {
      // Fetch most recent v2 stats and snapshots for each student-platform combination
      const v2StatsPromises: Array<Promise<{ studentId: string; platform: string; stat: any; snapshot: any } | null>> = [];
      
      for (const student of studentsWithV2Platforms) {
        for (const conn of student.platform_connections) {
          if (conn.platform === 'lichess' || conn.platform === 'chesscom') {
            v2StatsPromises.push(
              (async () => {
                const stat = await prisma.player_stats_v2.findFirst({
                  where: {
                    student_id: student.id,
                    platform: conn.platform,
                  },
                  orderBy: { computed_at: 'desc' },
                });
                
                // Fetch latest snapshot for this platform (source = platform name)
                const snapshot = await prisma.stats_snapshots.findFirst({
                  where: {
                    user_id: student.id,
                    source: conn.platform, // source = 'lichess' or 'chesscom'
                  },
                  orderBy: { captured_at: 'desc' },
                  select: {
                    rapid_rating: true,
                    blitz_rating: true,
                    puzzle_rating: true,
                  },
                });
                
                return stat ? { studentId: student.id, platform: conn.platform, stat, snapshot } : null;
              })()
            );
          }
        }
      }

      const v2StatsResults = await Promise.all(v2StatsPromises);
      for (const result of v2StatsResults) {
        if (result) {
          if (!v2StatsMap.has(result.studentId)) {
            v2StatsMap.set(result.studentId, new Map());
            v2SnapshotMap.set(result.studentId, new Map());
          }
          v2StatsMap.get(result.studentId)!.set(result.platform, result.stat);
          if (result.snapshot) {
            v2SnapshotMap.get(result.studentId)!.set(result.platform, result.snapshot);
          }
        }
      }
    }

    const formattedStudents = students.map((student) => {
      const connection = student.platform_connections.find(c => c.platform === 'lichess') 
        || student.platform_connections.find(c => c.platform === 'chesscom')
        || student.platform_connections[0];
      const latestStats = student.stats_snapshots[0];
      const platform = connection?.platform;
      const platformStatsMap = v2StatsMap.get(student.id);
      const platformSnapshotMap = v2SnapshotMap.get(student.id);
      const v2Stats = platform && (platform === 'lichess' || platform === 'chesscom') 
        ? platformStatsMap?.get(platform) 
        : null;
      // Get platform-specific snapshot for ratings (v2 platforms)
      const v2Snapshot = platform && (platform === 'lichess' || platform === 'chesscom')
        ? platformSnapshotMap?.get(platform)
        : null;

      // Determine stats source (v2 is default for Lichess and Chess.com)
      const isV2Platform = platform === 'lichess' || platform === 'chesscom';
      
      let statsSource: "v2" | "legacy" | "none" = "none";
      let rapidGames24h: number | null;
      let rapidGames7d: number | null;
      let blitzGames24h: number | null;
      let blitzGames7d: number | null;
      let puzzleTotal: number | null;
      let puzzle24h: number | null;
      let puzzle7d: number | null;
      let rapidRating: number | null;
      let blitzRating: number | null;
      let rapidRatingDelta24h: number | null;
      let rapidRatingDelta7d: number | null;
      let blitzRatingDelta24h: number | null;
      let blitzRatingDelta7d: number | null;

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
        lastSyncedAt = connection?.last_synced_at ? new Date(connection.last_synced_at).toISOString() : null;
        
        // Calculate statsIsStale: true if computedAt is null OR older than 2 hours
        if (statsComputedAt === null) {
          statsIsStale = true;
          // TODO: TEMPORARY DEBUG LOGGING - Remove after investigating stale badge issues
          const studentNickname = student.username || student.full_name || 'Unnamed';
          console.log(`[coach/students] [DEBUG] ${studentNickname} (${connection?.platform_username ?? 'no-username'}) marked STALE: statsComputedAt is null (no v2 stats record or computed_at is null)`);
        } else {
          const computedAtMs = new Date(statsComputedAt).getTime();
          const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
          statsIsStale = computedAtMs < twoHoursAgo;
          // TODO: TEMPORARY DEBUG LOGGING - Remove after investigating stale badge issues
          if (statsIsStale) {
            const studentNickname = student.username || student.full_name || 'Unnamed';
            const ageHours = ((Date.now() - computedAtMs) / (1000 * 60 * 60)).toFixed(1);
            console.log(`[coach/students] [DEBUG] ${studentNickname} (${connection?.platform_username ?? 'no-username'}) marked STALE: statsComputedAt=${statsComputedAt} (${ageHours}h old, threshold=2h)`);
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
        id: student.id,
        nickname: student.username || student.full_name || "Unnamed",
        platform: connection?.platform || "None",
        platform_username: connection?.platform_username || "",
        avatar_url: student.avatar_url,
        last_active: latestStats?.captured_at || connection?.last_synced_at || null,
        
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

    return NextResponse.json(formattedStudents);
  } catch (error) {
    console.error("Error in /api/coach/students:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
