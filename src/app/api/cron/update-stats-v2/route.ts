import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeFromLichess, computeFromChessCom } from '@/lib/stats/gamesActivityV2';
import { computeLichessPuzzleCountsForUser } from '@/lib/stats/computeLichessPuzzleCountsForUser';
import { computeChesscomRatingsForUser } from '@/lib/stats/computeChesscomRatingsForUser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  console.log('[update-stats-v2] Starting sync...');

  try {
    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const studentIdParam = searchParams.get('studentId');
    const platformParam = searchParams.get('platform');
    
    // Determine "now" once at the start of the run
    const now = new Date();

    let connectionsToProcess: Array<{
      id: string;
      user_id: string;
      platform: string;
      platform_username: string | null;
      last_synced_at: Date | null;
      profiles: { id: string; role: string } | null;
    }> = [];

    // If studentId and platform are provided, process only that specific student+platform
    if (studentIdParam && platformParam) {
      const platform = platformParam.toLowerCase();
      if (platform !== 'lichess' && platform !== 'chesscom') {
        return NextResponse.json({
          ok: false,
          error: `Invalid platform: ${platformParam}. Must be 'lichess' or 'chesscom'`,
          processed: 0,
          succeeded: 0,
          failed: [],
        }, { status: 400 });
      }

      const connection = await prisma.platform_connections.findFirst({
        where: {
          user_id: studentIdParam,
          platform: platform,
        },
        include: {
          profiles: {
            select: {
              id: true,
              role: true,
            },
          },
        },
      });

      if (connection && connection.profiles?.role === 'student' && connection.platform_username && connection.platform_username.trim() !== '') {
        connectionsToProcess = [connection];
      } else {
        return NextResponse.json({
          ok: false,
          error: `No eligible connection found for studentId=${studentIdParam}, platform=${platformParam}`,
          processed: 0,
          succeeded: 0,
          failed: [],
        }, { status: 404 });
      }
    } else {
      // Original logic: process all connections with limit/offset
      const limitRaw = searchParams.get('limit');
      const offsetRaw = searchParams.get('offset');
      
      let limit = limitRaw ? parseInt(limitRaw, 10) : 50;
      if (isNaN(limit) || limit < 1) limit = 1;
      if (limit > 100) limit = 100;
      
      let offset = offsetRaw ? parseInt(offsetRaw, 10) : 0;
      if (isNaN(offset) || offset < 0) offset = 0;

      // Load all platform_connections where platform IN ('lichess','chesscom')
      const connections = await prisma.platform_connections.findMany({
        where: {
          platform: {
            in: ['lichess', 'chesscom'],
          },
        },
        include: {
          profiles: {
            select: {
              id: true,
              role: true,
            },
          },
        },
      });

      // Filter to only students with valid usernames (non-null and non-empty)
      const eligibleConnections = connections.filter(
        (conn) =>
          conn.profiles?.role === 'student' &&
          conn.platform_username &&
          conn.platform_username.trim() !== ''
      );

      // Sort by last_synced_at (nulls last) for consistent processing order
      eligibleConnections.sort((a, b) => {
        if (!a.last_synced_at && !b.last_synced_at) return 0;
        if (!a.last_synced_at) return 1; // nulls last
        if (!b.last_synced_at) return -1;
        return b.last_synced_at.getTime() - a.last_synced_at.getTime(); // desc
      });

      connectionsToProcess = eligibleConnections.slice(offset, offset + limit);
    }

    if (connectionsToProcess.length === 0) {
      console.log('[update-stats-v2] No eligible connections found');
      return NextResponse.json({
        ok: false,
        error: 'No eligible connections found',
        processed: 0,
        succeeded: 0,
        failed: [],
      });
    }

    console.log(`[update-stats-v2] Processing ${connectionsToProcess.length} connection(s)`);

    const succeeded: Array<{
      studentId: string;
      platform: string;
      username: string;
      ok: true;
    }> = [];

    const failed: Array<{
      studentId: string;
      platform: string;
      username: string;
      ok: false;
      errorCode?: string;
      errorMessage: string;
    }> = [];

    // Process each connection sequentially
    for (let i = 0; i < connectionsToProcess.length; i++) {
      const connection = connectionsToProcess[i];
      const studentId = connection.user_id;
      const platform = connection.platform as 'lichess' | 'chesscom';
      const username = connection.platform_username!;

      // Extract error code from error message (check for 429 rate limit)
      let errorCode: string | undefined = undefined;
      let errorMessage = '';
      let updateOk = false;

      try {
        console.log(`[update-stats-v2] Processing ${platform}/${username} (studentId: ${studentId})`);

        // TODO: TEMPORARY DEBUG LOGGING - Remove after investigating stale badge issues
        const existingStats = await prisma.player_stats_v2.findUnique({
          where: {
            student_id_platform: {
              student_id: studentId,
              platform: platform === 'chesscom' ? 'chesscom' : platform,
            },
          },
        });
        if (existingStats) {
          console.log(`[update-stats-v2] [DEBUG] ${username} existing computed_at: ${existingStats.computed_at?.toISOString() ?? 'null'}, last_update_ok: ${existingStats.last_update_ok}, last_update_error_code: ${existingStats.last_update_error_code}`);
        } else {
          console.log(`[update-stats-v2] [DEBUG] ${username} no existing stats record`);
        }

        // Compute stats using the pure computation module (throws on API failure)
        let counts;
        if (platform === 'lichess') {
          counts = await computeFromLichess({
            username,
            now,
            token: process.env.LICHESS_TOKEN ?? undefined,
          });
        } else if (platform === 'chesscom') {
          counts = await computeFromChessCom({
            username,
            now,
          });
        } else {
          throw new Error(`Unsupported platform: ${platform}`);
        }

        // Only update database if computation succeeded (no throw)
        // Map from camelCase (module) to snake_case (DB)
        const stats = {
          rapid_24h: counts.rapid24h,
          rapid_7d: counts.rapid7d,
          blitz_24h: counts.blitz24h,
          blitz_7d: counts.blitz7d,
        };

        // Fetch current ratings for Lichess users
        let rapidRating: number | null = null;
        let blitzRating: number | null = null;

        if (platform === 'lichess') {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const userResponse = await fetch(`https://lichess.org/api/user/${username}`, {
              signal: controller.signal,
              headers: {
                'Accept': 'application/json',
              },
            });

            clearTimeout(timeoutId);

            if (userResponse.ok) {
              const userData = await userResponse.json();
              rapidRating = userData?.perfs?.rapid?.rating ?? null;
              blitzRating = userData?.perfs?.blitz?.rating ?? null;
            }
          } catch (ratingError) {
            // Non-fatal: log but continue without ratings
            console.warn(`[update-stats-v2] Failed to fetch ratings for ${platform}/${username}:`, ratingError);
          }
        } else if (platform === 'chesscom') {
          // Fetch Chess.com ratings
          const chesscomRatings = await computeChesscomRatingsForUser(username);
          rapidRating = chesscomRatings.rapidRating;
          blitzRating = chesscomRatings.blitzRating;
        }

        // Compute rating deltas using snapshot baseline method (before creating new snapshot)
        let rapidRatingDelta24h: number | null = null;
        let rapidRatingDelta7d: number | null = null;
        let blitzRatingDelta24h: number | null = null;
        let blitzRatingDelta7d: number | null = null;

        if (rapidRating !== null || blitzRating !== null) {
          const window24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          const window7dStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

          // Find baseline snapshot for 24h window
          const baseline24h = await prisma.stats_snapshots.findFirst({
            where: {
              user_id: studentId,
              captured_at: { lte: window24hStart },
            },
            orderBy: { captured_at: 'desc' },
            select: { rapid_rating: true, blitz_rating: true, captured_at: true },
          });

          // Baseline is VALID only if captured_at >= (windowStart24 - 12 hours)
          const baseline24hFreshnessThreshold = new Date(window24hStart.getTime() - 12 * 60 * 60 * 1000);
          const isBaseline24hValid =
            baseline24h &&
            baseline24h.captured_at >= baseline24hFreshnessThreshold;

          if (isBaseline24hValid) {
            // Compute rapid rating delta 24h
            if (rapidRating !== null && baseline24h.rapid_rating !== null && baseline24h.rapid_rating !== undefined) {
              const delta = rapidRating - baseline24h.rapid_rating;
              rapidRatingDelta24h = !isNaN(delta) ? delta : null;
            }

            // Compute blitz rating delta 24h
            if (blitzRating !== null && baseline24h.blitz_rating !== null && baseline24h.blitz_rating !== undefined) {
              const delta = blitzRating - baseline24h.blitz_rating;
              blitzRatingDelta24h = !isNaN(delta) ? delta : null;
            }
          }

          // Find baseline snapshot for 7d window
          const baseline7d = await prisma.stats_snapshots.findFirst({
            where: {
              user_id: studentId,
              captured_at: { lte: window7dStart },
            },
            orderBy: { captured_at: 'desc' },
            select: { rapid_rating: true, blitz_rating: true, captured_at: true },
          });

          // Baseline is VALID only if captured_at >= (windowStart7d - 24 hours)
          const baseline7dFreshnessThreshold = new Date(window7dStart.getTime() - 24 * 60 * 60 * 1000);
          const isBaseline7dValid =
            baseline7d &&
            baseline7d.captured_at >= baseline7dFreshnessThreshold;

          if (isBaseline7dValid) {
            // Compute rapid rating delta 7d
            if (rapidRating !== null && baseline7d.rapid_rating !== null && baseline7d.rapid_rating !== undefined) {
              const delta = rapidRating - baseline7d.rapid_rating;
              rapidRatingDelta7d = !isNaN(delta) ? delta : null;
            }

            // Compute blitz rating delta 7d
            if (blitzRating !== null && baseline7d.blitz_rating !== null && baseline7d.blitz_rating !== undefined) {
              const delta = blitzRating - baseline7d.blitz_rating;
              blitzRatingDelta7d = !isNaN(delta) ? delta : null;
            }
          }
        }

        // Compute puzzle total for Lichess users (before upserting player_stats_v2)
        let puzzleTotal: number | null = null;
        let puzzle24h: number | null = null;
        let puzzle7d: number | null = null;

        if (platform === 'lichess') {
          const puzzleRes = await computeLichessPuzzleCountsForUser(studentId);

          if (puzzleRes.status === 'OK') {
            puzzleTotal = puzzleRes.puzzleTotal;

            // Compute puzzle_24h and puzzle_7d using snapshot-delta method
            if (puzzleTotal !== null) {
              const window24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
              const window7dStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

              // Find baseline snapshot for 24h window: latest snapshot at/<= window24hStart
              const baseline24h = await prisma.stats_snapshots.findFirst({
                where: {
                  user_id: studentId,
                  captured_at: { lte: window24hStart },
                },
                orderBy: { captured_at: 'desc' },
                select: { puzzle_total: true, captured_at: true },
              });

              // Compute 24h delta only if baseline exists, has valid puzzle_total, and is fresh enough
              // Baseline is VALID only if captured_at >= (windowStart24 - 12 hours)
              const baseline24hFreshnessThreshold = new Date(window24hStart.getTime() - 12 * 60 * 60 * 1000);
              const isBaseline24hValid =
                baseline24h &&
                baseline24h.puzzle_total !== null &&
                baseline24h.puzzle_total !== undefined &&
                baseline24h.captured_at >= baseline24hFreshnessThreshold;

              if (isBaseline24hValid) {
                const delta24h = puzzleTotal - baseline24h.puzzle_total;
                puzzle24h = delta24h >= 0 ? delta24h : null; // null if counter reset/anomaly
              } else {
                // No baseline snapshot, baseline.puzzle_total is null, or baseline is too old
                puzzle24h = null;
              }

              // Find baseline snapshot for 7d window: latest snapshot at/<= window7dStart
              const baseline7d = await prisma.stats_snapshots.findFirst({
                where: {
                  user_id: studentId,
                  captured_at: { lte: window7dStart },
                },
                orderBy: { captured_at: 'desc' },
                select: { puzzle_total: true, captured_at: true },
              });

              // Compute 7d delta only if baseline exists, has valid puzzle_total, and is fresh enough
              // Baseline is VALID only if captured_at >= (windowStart7d - 24 hours)
              const baseline7dFreshnessThreshold = new Date(window7dStart.getTime() - 24 * 60 * 60 * 1000);
              const isBaseline7dValid =
                baseline7d &&
                baseline7d.puzzle_total !== null &&
                baseline7d.puzzle_total !== undefined &&
                baseline7d.captured_at >= baseline7dFreshnessThreshold;

              if (isBaseline7dValid) {
                const delta7d = puzzleTotal - baseline7d.puzzle_total;
                puzzle7d = delta7d >= 0 ? delta7d : null; // null if counter reset/anomaly
              } else {
                // No baseline snapshot, baseline.puzzle_total is null, or baseline is too old
                puzzle7d = null;
              }
            } else {
              // puzzleTotal is null, so puzzle_24h and puzzle_7d must be null
              puzzle24h = null;
              puzzle7d = null;
            }
          } else {
            // On error, puzzleTotal, puzzle24h, puzzle7d remain null
            puzzleTotal = null;
            puzzle24h = null;
            puzzle7d = null;
          }
        }

        // Upsert into player_stats_v2 using the unique constraint (student_id + platform)
        // ALWAYS upsert with computed_at set to now(), even when counts are 0
        await prisma.player_stats_v2.upsert({
          where: {
            student_id_platform: {
              student_id: studentId,
              platform: platform === 'chesscom' ? 'chesscom' : platform,
            },
          },
          update: {
            rapid_24h: stats.rapid_24h,
            rapid_7d: stats.rapid_7d,
            blitz_24h: stats.blitz_24h,
            blitz_7d: stats.blitz_7d,
            puzzle_total: puzzleTotal,
            puzzle_24h: puzzle24h,
            puzzle_7d: puzzle7d,
            rapid_rating_delta_24h: rapidRatingDelta24h,
            rapid_rating_delta_7d: rapidRatingDelta7d,
            blitz_rating_delta_24h: blitzRatingDelta24h,
            blitz_rating_delta_7d: blitzRatingDelta7d,
            computed_at: now,
            last_update_ok: true,
            last_update_error_code: null,
            last_update_error_message: null,
            last_update_attempt_at: now,
          },
          create: {
            student_id: studentId,
            platform: platform === 'chesscom' ? 'chesscom' : platform,
            rapid_24h: stats.rapid_24h,
            rapid_7d: stats.rapid_7d,
            blitz_24h: stats.blitz_24h,
            blitz_7d: stats.blitz_7d,
            puzzle_total: puzzleTotal,
            puzzle_24h: puzzle24h,
            puzzle_7d: puzzle7d,
            rapid_rating_delta_24h: rapidRatingDelta24h,
            rapid_rating_delta_7d: rapidRatingDelta7d,
            blitz_rating_delta_24h: blitzRatingDelta24h,
            blitz_rating_delta_7d: blitzRatingDelta7d,
            computed_at: now,
            last_update_ok: true,
            last_update_error_code: null,
            last_update_error_message: null,
            last_update_attempt_at: now,
          },
        });

        console.log(`[update-stats-v2] upserted player_stats_v2 studentId=${studentId} platform=${platform} computed_at=${now.toISOString()}`);

        // Update platform_connections.last_synced_at when sync succeeded
        await prisma.platform_connections.update({
          where: {
            id: connection.id,
          },
          data: {
            last_synced_at: now,
          },
        });

        // Main success path completed - student is now considered succeeded
        updateOk = true;
        succeeded.push({
          studentId,
          platform,
          username,
          ok: true,
        });

        console.log(
          `[update-stats-v2] ✓ Success: ${platform}/${username} - rapid: ${stats.rapid_24h}/${stats.rapid_7d}, blitz: ${stats.blitz_24h}/${stats.blitz_7d}`
        );

        // Fallback: if ratings are null, try to preserve last known values from previous snapshot
        let finalRapidRating = rapidRating;
        let finalBlitzRating = blitzRating;
        
        if (rapidRating === null || blitzRating === null) {
          const lastSnapshot = await prisma.stats_snapshots.findFirst({
            where: {
              user_id: studentId,
              source: platform, // platform-specific snapshot
            },
            orderBy: { captured_at: 'desc' },
            select: {
              rapid_rating: true,
              blitz_rating: true,
            },
          });
          
          if (lastSnapshot) {
            if (finalRapidRating === null && lastSnapshot.rapid_rating !== null) {
              finalRapidRating = lastSnapshot.rapid_rating;
            }
            if (finalBlitzRating === null && lastSnapshot.blitz_rating !== null) {
              finalBlitzRating = lastSnapshot.blitz_rating;
            }
          }
        }

        // Insert snapshot history (NON-FATAL: wrapped in try/catch)
        // If snapshot insertion fails, log warning but don't fail the student sync
        // This snapshot is needed for rating deltas and to track current rating values
        try {
          await prisma.stats_snapshots.create({
            data: {
              user_id: studentId,
              captured_at: now,
              source: platform, // platform is 'lichess' or 'chesscom' (matches DB constraint)
              rapid_rating: finalRapidRating,
              blitz_rating: finalBlitzRating,
              rapid_24h: stats.rapid_24h,
              rapid_7d: stats.rapid_7d,
              blitz_24h: stats.blitz_24h,
              blitz_7d: stats.blitz_7d,
              puzzle_total: puzzleTotal,
              puzzle_24h: puzzle24h,
              puzzle_7d: puzzle7d,
              // Leave other rating/puzzle fields as default/null/0
              puzzle_rating: null,
              rapid_total: null,
              blitz_total: null,
            },
          });
        } catch (snapshotError) {
          // Log warning but don't fail the student sync
          console.warn(
            `[update-stats-v2] Warning: Failed to insert snapshot for ${platform}/${username} (studentId: ${studentId}):`,
            snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
          );
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        
        // Extract error code: check for 429 rate limit in error message
        // Error format from gamesActivityV2: "Lichess {perfType} API returned {status} {statusText} for {username}"
        if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
          errorCode = 'RATE_LIMIT';
        }

        // TODO: TEMPORARY DEBUG LOGGING - Remove after investigating stale badge issues
        console.error(`[update-stats-v2] [DEBUG] ${username} FAILED: error="${errorMessage}", errorCode="${errorCode ?? 'none'}", computed_at will remain null -> will be marked STALE`);

        failed.push({
          studentId,
          platform,
          username,
          ok: false,
          errorCode,
          errorMessage,
        });

        console.error(
          `[update-stats-v2] ✗ Failed: ${platform}/${username} (studentId: ${studentId}) - ${errorMessage}${errorCode ? ` [${errorCode}]` : ''}`
        );

        // Persist failure info to player_stats_v2 (even on failure, we track the attempt)
        // Note: On failure, we do NOT set computed_at (it remains null) to indicate stale data
        try {
          await prisma.player_stats_v2.upsert({
            where: {
              student_id_platform: {
                student_id: studentId,
                platform: platform === 'chesscom' ? 'chesscom' : platform,
              },
            },
            update: {
              last_update_ok: false,
              last_update_error_code: errorCode || null,
              last_update_error_message: errorMessage.substring(0, 500), // Limit message length
              last_update_attempt_at: now,
              // Do NOT update computed_at on failure - leave it as-is (null or old value)
            },
            create: {
              student_id: studentId,
              platform: platform === 'chesscom' ? 'chesscom' : platform,
              rapid_24h: null,
              rapid_7d: null,
              blitz_24h: null,
              blitz_7d: null,
              computed_at: null,
              last_update_ok: false,
              last_update_error_code: errorCode || null,
              last_update_error_message: errorMessage.substring(0, 500),
              last_update_attempt_at: now,
            },
          });
        } catch (dbError) {
          // Log but don't fail - we've already recorded the failure
          console.warn(
            `[update-stats-v2] Warning: Failed to persist error info for ${platform}/${username} (studentId: ${studentId}):`,
            dbError instanceof Error ? dbError.message : String(dbError)
          );
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[update-stats-v2] Completed in ${duration}ms - succeeded: ${succeeded.length}, failed: ${failed.length}`
    );

    return NextResponse.json({
      ok: true,
      processed: connectionsToProcess.length,
      succeeded: succeeded.length,
      failed: failed.length,
      succeededItems: succeeded,
      failedItems: failed,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[update-stats-v2] Fatal error after ${duration}ms:`, error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        processed: 0,
        succeeded: 0,
        failed: [],
      },
      { status: 500 }
    );
  }
}
