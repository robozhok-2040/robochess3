import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

/**
 * Helper: Count Lichess games from NDJSON export for a time window
 */
async function countLichessGamesWindow(
  username: string,
  perfType: "rapid" | "blitz",
  sinceMs: number,
  max: number = 400
): Promise<number> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    try {
      const response = await fetch(
        `https://lichess.org/api/games/user/${username}?since=${sinceMs}&max=${max}&perfType=${perfType}&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`,
        { 
          headers: { Accept: "application/x-ndjson" },
          signal: controller.signal
        }
      );
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const text = await response.text();
        return text.split("\n").filter((line) => line.trim().length > 0).length;
      }
      return 0;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      return 0;
    }
  } catch (error) {
    return 0;
  }
}

/**
 * Helper: Fetch Lichess NDJSON with diagnostic info (debug only)
 */
async function fetchLichessNdjsonDebug(url: string): Promise<{
  url: string;
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  lines: number | null;
  sampleLines: string[];
  error?: string;
}> {
  const diagnostics = {
    url,
    status: null as number | null,
    contentType: null as string | null,
    bytes: null as number | null,
    lines: null as number | null,
    sampleLines: [] as string[],
    error: undefined as string | undefined,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/x-ndjson",
          "User-Agent": "RoboChess/1.0 (debug)"
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      diagnostics.status = response.status;
      diagnostics.contentType = response.headers.get("content-type") || null;
      
      // Read response body exactly once
      const text = await response.text();
      
      // Calculate bytes using Buffer.byteLength (correct byte count)
      diagnostics.bytes = Buffer.byteLength(text, "utf8");
      
      // Count non-empty lines
      const lines = text.split("\n").filter((line) => line.trim().length > 0);
      diagnostics.lines = lines.length;
      
      // Get first 2 non-empty lines, truncate to 200 chars each
      if (lines.length > 0) {
        diagnostics.sampleLines = lines.slice(0, 2).map(line => 
          line.length > 200 ? line.substring(0, 200) + "..." : line
        );
      } else if (text.length > 0) {
        // No NDJSON lines, but there's content (maybe HTML error page)
        const truncated = text.length > 200 ? text.substring(0, 200) + "..." : text;
        diagnostics.sampleLines = [truncated];
      }
      
      return diagnostics;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      diagnostics.error = fetchError instanceof Error ? fetchError.message : String(fetchError);
      return diagnostics;
    }
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : String(error);
    return diagnostics;
  }
}

/**
 * Helper: Count Chess.com games from archives for time windows
 */
async function countChessComGamesWindow(
  username: string,
  timeClass: "rapid" | "blitz",
  since24hMs: number,
  since7dMs: number
): Promise<{ games24h: number; games7d: number }> {
  let games24h = 0;
  let games7d = 0;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    try {
      const archivesResponse = await fetch(
        `https://api.chess.com/pub/player/${username}/games/archives`,
        { 
          headers: { Accept: "application/json" },
          signal: controller.signal
        }
      );
      clearTimeout(timeoutId);
      
      if (!archivesResponse.ok) {
        return { games24h: 0, games7d: 0 };
      }

      const archivesData = await archivesResponse.json();
      const recentArchives = (archivesData.archives || []).slice(-3); // Take last 3 to cover 7d window

      for (const archiveUrl of recentArchives) {
        try {
          const archiveController = new AbortController();
          const archiveTimeout = setTimeout(() => archiveController.abort(), 8000);
          
          const archiveResponse = await fetch(archiveUrl, { 
            headers: { Accept: "application/json" },
            signal: archiveController.signal
          });
          clearTimeout(archiveTimeout);
          
          if (archiveResponse.ok) {
            const data = await archiveResponse.json();
            for (const game of (data.games || [])) {
              if (game.time_class === timeClass && game.end_time) {
                const endMs = game.end_time * 1000;
                if (endMs >= since24hMs) {
                  games24h++;
                  games7d++;
                } else if (endMs >= since7dMs) {
                  games7d++;
                }
              }
            }
          }
        } catch (e) {
          // Skip failed archive fetch
        }
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      return { games24h: 0, games7d: 0 };
    }
  } catch (error) {
    return { games24h: 0, games7d: 0 };
  }
  
  return { games24h, games7d };
}

export async function GET() {
  try {
    const students = await prisma.profiles.findMany({
      where: { role: "student" },
      include: {
        platform_connections: true, // Include all platforms, not just lichess
        stats_snapshots: { 
          orderBy: { captured_at: 'desc' }, 
          take: 1
        }
      }
    });

    const updates = [];
    const now = Date.now();
    const since24hMs = now - 24 * 60 * 60 * 1000;
    const since7dMs = now - 7 * 24 * 60 * 60 * 1000;
    const oneDayAgo = new Date(since24hMs);
    const sevenDaysAgo = new Date(since7dMs);
    const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
    
    // Diagnostic tracking for test user (declared in top-level scope)
    let lichessDebug: {
      username: string;
      rapid: {
        url: string;
        status: number | null;
        contentType: string | null;
        bytes: number | null;
        lines: number | null;
        sampleLines: string[];
        error?: string;
      };
      blitz: {
        url: string;
        status: number | null;
        contentType: string | null;
        bytes: number | null;
        lines: number | null;
        sampleLines: string[];
        error?: string;
      };
    } | null = null;

    // Find test user exactly: "aboudey" first, else "robozhok"
    let testUserUsername: string | null = null;
    for (const student of students) {
      for (const conn of student.platform_connections) {
        if (conn.platform === 'lichess' && conn.platform_username) {
          const uname = conn.platform_username.trim();
          if (uname === 'aboudey') {
            testUserUsername = uname;
            break;
          } else if (uname === 'robozhok' && !testUserUsername) {
            testUserUsername = uname;
          }
        }
      }
      if (testUserUsername === 'aboudey') break; // Prefer aboudey
    }

    for (const student of students) {
      // Process each platform connection
      for (const connection of student.platform_connections) {
        if (!connection.platform_username || connection.platform_username.trim() === '') {
          updates.push(`SKIP connection ${connection.id} (platform: ${connection.platform}): missing platform_username`);
          continue;
        }

        const username = connection.platform_username.trim();
        
        try {
          const latestSnapshot = student.stats_snapshots[0];
          
          // Find snapshots for time-based calculations
          const snapshot24hAgo = await prisma.stats_snapshots.findFirst({
            where: {
              user_id: student.id,
              captured_at: { lte: oneDayAgo }
            },
            orderBy: { captured_at: 'desc' },
            take: 1
          });

          const snapshot7dAgo = await prisma.stats_snapshots.findFirst({
            where: {
              user_id: student.id,
              captured_at: { lte: sevenDaysAgo }
            },
            orderBy: { captured_at: 'desc' },
            take: 1
          });

          // Determine if we should use history-based calculation (with throttling)
          // Override throttle if snapshots are missing AND we have zeros
          const needsHistoryRapid24h = !snapshot24hAgo || (latestSnapshot && latestSnapshot.rapid_24h === 0);
          const needsHistoryBlitz24h = !snapshot24hAgo || (latestSnapshot && latestSnapshot.blitz_24h === 0);
          const needsHistoryRapid7d = !snapshot7dAgo || (latestSnapshot && latestSnapshot.rapid_7d === 0);
          const needsHistoryBlitz7d = !snapshot7dAgo || (latestSnapshot && latestSnapshot.blitz_7d === 0);
          
          // Check throttling: allow if last_synced_at is null/older than 6h, OR if we need history (override)
          const needsAnyHistory = needsHistoryRapid24h || needsHistoryBlitz24h || needsHistoryRapid7d || needsHistoryBlitz7d;
          const canUseHistory = !connection.last_synced_at || 
            new Date(connection.last_synced_at) < sixHoursAgo ||
            needsAnyHistory;

          let rapid24h = latestSnapshot?.rapid_24h ?? 0;
          let blitz24h = latestSnapshot?.blitz_24h ?? 0;
          let rapid7d = latestSnapshot?.rapid_7d ?? 0;
          let blitz7d = latestSnapshot?.blitz_7d ?? 0;
          let rapid24hMethod = 'snapshot';
          let blitz24hMethod = 'snapshot';
          let rapid7dMethod = 'snapshot';
          let blitz7dMethod = 'snapshot';
          let historyFetchError = false;

          // --- PLATFORM-SPECIFIC LOGIC ---
          if (connection.platform === 'lichess') {
            // Fetch Lichess profile for ratings and totals
            const response = await fetch(`https://lichess.org/api/user/${username}`);
            if (!response.ok) {
              updates.push(`SKIP ${username} (lichess): API error ${response.status}`);
              continue;
            }

            const data = await response.json();
            const currRapid = data.perfs?.rapid?.games ?? 0;
            const currBlitz = data.perfs?.blitz?.games ?? 0;
            const currPuzzle = data.perfs?.puzzle?.games ?? 0;

            // History-based calculation if allowed
            if (canUseHistory) {
              try {
                // Check if this is the exact test user for diagnostics
                if (testUserUsername && username === testUserUsername && !lichessDebug) {
                  // Use diagnostic fetch for test user (7d window, max=50 for debug, sequential with delay)
                  const rapidUrl = `https://lichess.org/api/games/user/${username}?since=${since7dMs}&max=50&perfType=rapid&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`;
                  const rapidDiagnostics = await fetchLichessNdjsonDebug(rapidUrl);
                  
                  // Delay to reduce 429 risk
                  await new Promise(r => setTimeout(r, 1200));
                  
                  const blitzUrl = `https://lichess.org/api/games/user/${username}?since=${since7dMs}&max=50&perfType=blitz&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`;
                  const blitzDiagnostics = await fetchLichessNdjsonDebug(blitzUrl);
                  
                  lichessDebug = {
                    username,
                    rapid: rapidDiagnostics,
                    blitz: blitzDiagnostics
                  };
                  
                  // Use the line counts from diagnostics for 7d
                  rapid7d = rapidDiagnostics.lines ?? 0;
                  blitz7d = blitzDiagnostics.lines ?? 0;
                  
                  // Fetch 24h stats normally (without diagnostics)
                  rapid24h = await countLichessGamesWindow(username, 'rapid', since24hMs, 200);
                  blitz24h = await countLichessGamesWindow(username, 'blitz', since24hMs, 200);
                } else {
                  // Normal fetch for non-test users
                  // Fetch 24h stats
                  const rapid24hCount = await countLichessGamesWindow(username, 'rapid', since24hMs, 200);
                  const blitz24hCount = await countLichessGamesWindow(username, 'blitz', since24hMs, 200);
                  
                  // Fetch 7d stats
                  const rapid7dCount = await countLichessGamesWindow(username, 'rapid', since7dMs, 400);
                  const blitz7dCount = await countLichessGamesWindow(username, 'blitz', since7dMs, 400);

                  rapid24h = rapid24hCount;
                  blitz24h = blitz24hCount;
                  rapid7d = rapid7dCount;
                  blitz7d = blitz7dCount;
                }
                
                rapid24hMethod = 'history';
                blitz24hMethod = 'history';
                rapid7dMethod = 'history';
                blitz7dMethod = 'history';

                // Update last_synced_at after successful history fetch
                await prisma.platform_connections.update({
                  where: { id: connection.id },
                  data: { last_synced_at: new Date() }
                });
              } catch (err) {
                historyFetchError = true;
                // Keep previous values on error
              }
            }

            // Fallback to snapshot-delta if history was skipped by throttle
            // Only overwrite if we get valid snapshot-based values; otherwise keep previous values
            if (!canUseHistory || historyFetchError) {
              // 24h: snapshot-based (only if we get a valid calculation)
              if (snapshot24hAgo?.rapid_total !== null && snapshot24hAgo?.rapid_total !== undefined) {
                const calculated = Math.max(0, currRapid - (snapshot24hAgo.rapid_total ?? 0));
                rapid24h = calculated;
                rapid24hMethod = 'snapshot';
              } else if (latestSnapshot?.rapid_total !== null && latestSnapshot?.rapid_total !== undefined && latestSnapshot.rapid_total > 0) {
                const calculated = Math.max(0, currRapid - latestSnapshot.rapid_total);
                rapid24h = calculated;
                rapid24hMethod = 'snapshot';
              }
              // else: keep previous rapid24h value

              if (snapshot24hAgo?.blitz_total !== null && snapshot24hAgo?.blitz_total !== undefined) {
                const calculated = Math.max(0, currBlitz - (snapshot24hAgo.blitz_total ?? 0));
                blitz24h = calculated;
                blitz24hMethod = 'snapshot';
              } else if (latestSnapshot?.blitz_total !== null && latestSnapshot?.blitz_total !== undefined && latestSnapshot.blitz_total > 0) {
                const calculated = Math.max(0, currBlitz - latestSnapshot.blitz_total);
                blitz24h = calculated;
                blitz24hMethod = 'snapshot';
              }
              // else: keep previous blitz24h value

              // 7d: snapshot-based (only if we get a valid calculation)
              if (snapshot7dAgo?.rapid_total !== null && snapshot7dAgo?.rapid_total !== undefined) {
                const calculated = Math.max(0, currRapid - (snapshot7dAgo.rapid_total ?? 0));
                rapid7d = calculated;
                rapid7dMethod = 'snapshot';
              }
              // else: keep previous rapid7d value

              if (snapshot7dAgo?.blitz_total !== null && snapshot7dAgo?.blitz_total !== undefined) {
                const calculated = Math.max(0, currBlitz - (snapshot7dAgo.blitz_total ?? 0));
                blitz7d = calculated;
                blitz7dMethod = 'snapshot';
              }
              // else: keep previous blitz7d value
            }

            // Puzzle calculation (keep current behavior)
            let puzzleDelta24h = 0;
            if (snapshot24hAgo?.puzzle_total !== null && snapshot24hAgo?.puzzle_total !== undefined) {
              puzzleDelta24h = Math.max(0, currPuzzle - (snapshot24hAgo.puzzle_total ?? 0));
            } else if (latestSnapshot?.puzzle_total !== null && latestSnapshot?.puzzle_total !== undefined && latestSnapshot.puzzle_total > 0) {
              puzzleDelta24h = Math.max(0, currPuzzle - latestSnapshot.puzzle_total);
            }

            let puzzleDelta7d = latestSnapshot?.puzzle_7d ?? 0;
            if (snapshot7dAgo?.puzzle_total !== null && snapshot7dAgo?.puzzle_total !== undefined) {
              puzzleDelta7d = Math.max(0, currPuzzle - (snapshot7dAgo.puzzle_total ?? 0));
            }

            // Save snapshot
            await prisma.stats_snapshots.create({
              data: {
                user_id: student.id,
                source: "lichess",
                rapid_rating: data.perfs?.rapid?.rating ?? null,
                blitz_rating: data.perfs?.blitz?.rating ?? null,
                puzzle_rating: data.perfs?.puzzle?.rating ?? null,
                rapid_24h: rapid24h,
                blitz_24h: blitz24h,
                rapid_7d: rapid7d,
                blitz_7d: blitz7d,
                puzzle_24h: puzzleDelta24h,
                puzzle_7d: puzzleDelta7d,
                rapid_total: currRapid,
                blitz_total: currBlitz,
                puzzle_total: currPuzzle,
                captured_at: new Date()
              }
            });

            // Build details string
            const method24h = (rapid24hMethod === 'history' || blitz24hMethod === 'history') ? 'history' : 'snapshot';
            const method7d = (rapid7dMethod === 'history' || blitz7dMethod === 'history') ? 'history' : 'snapshot';
            const throttleReason = !canUseHistory && !historyFetchError ? ` throttle(${connection.last_synced_at ? Math.round((now - new Date(connection.last_synced_at).getTime()) / (1000 * 60 * 60) * 10) / 10 : 'never'}h)` : '';
            const errorMarker = historyFetchError ? ' [HISTORY_ERROR]' : '';
            const detailString = `${username} (${connection.platform}): [24h=${method24h}] [7d=${method7d}] R24h=${rapid24h} R7d=${rapid7d} B24h=${blitz24h} B7d=${blitz7d}${throttleReason}${errorMarker}`;
            updates.push(detailString);

          } else if (connection.platform === 'chesscom' || connection.platform === 'chess.com') {
            // Fetch Chess.com profile for ratings and totals
            const profileResponse = await fetch(`https://api.chess.com/pub/player/${username}`);
            if (!profileResponse.ok) {
              updates.push(`SKIP ${username} (chess.com): API error ${profileResponse.status}`);
              continue;
            }

            const statsResponse = await fetch(`https://api.chess.com/pub/player/${username}/stats`);
            let chesscomStats = null;
            if (statsResponse.ok) {
              chesscomStats = await statsResponse.json();
            }

            const currRapid = chesscomStats?.chess_rapid?.record?.win + chesscomStats?.chess_rapid?.record?.loss + chesscomStats?.chess_rapid?.record?.draw || 0;
            const currBlitz = chesscomStats?.chess_blitz?.record?.win + chesscomStats?.chess_blitz?.record?.loss + chesscomStats?.chess_blitz?.record?.draw || 0;
            const rapidRating = chesscomStats?.chess_rapid?.last?.rating ?? null;
            const blitzRating = chesscomStats?.chess_blitz?.last?.rating ?? null;

            // History-based calculation if allowed
            if (canUseHistory) {
              try {
                const rapidCounts = await countChessComGamesWindow(username, 'rapid', since24hMs, since7dMs);
                const blitzCounts = await countChessComGamesWindow(username, 'blitz', since24hMs, since7dMs);

                rapid24h = rapidCounts.games24h;
                blitz24h = blitzCounts.games24h;
                rapid7d = rapidCounts.games7d;
                blitz7d = blitzCounts.games7d;

                rapid24hMethod = 'history';
                blitz24hMethod = 'history';
                rapid7dMethod = 'history';
                blitz7dMethod = 'history';

                // Update last_synced_at after successful history fetch
                await prisma.platform_connections.update({
                  where: { id: connection.id },
                  data: { last_synced_at: new Date() }
                });
              } catch (err) {
                historyFetchError = true;
                // Keep previous values on error
              }
            }

            // Fallback to snapshot-delta if history was skipped by throttle
            // Only overwrite if we get valid snapshot-based values; otherwise keep previous values
            if (!canUseHistory || historyFetchError) {
              // 24h: snapshot-based (only if we get a valid calculation)
              if (snapshot24hAgo?.rapid_total !== null && snapshot24hAgo?.rapid_total !== undefined) {
                const calculated = Math.max(0, currRapid - (snapshot24hAgo.rapid_total ?? 0));
                rapid24h = calculated;
                rapid24hMethod = 'snapshot';
              } else if (latestSnapshot?.rapid_total !== null && latestSnapshot?.rapid_total !== undefined && latestSnapshot.rapid_total > 0) {
                const calculated = Math.max(0, currRapid - latestSnapshot.rapid_total);
                rapid24h = calculated;
                rapid24hMethod = 'snapshot';
              }
              // else: keep previous rapid24h value

              if (snapshot24hAgo?.blitz_total !== null && snapshot24hAgo?.blitz_total !== undefined) {
                const calculated = Math.max(0, currBlitz - (snapshot24hAgo.blitz_total ?? 0));
                blitz24h = calculated;
                blitz24hMethod = 'snapshot';
              } else if (latestSnapshot?.blitz_total !== null && latestSnapshot?.blitz_total !== undefined && latestSnapshot.blitz_total > 0) {
                const calculated = Math.max(0, currBlitz - latestSnapshot.blitz_total);
                blitz24h = calculated;
                blitz24hMethod = 'snapshot';
              }
              // else: keep previous blitz24h value

              // 7d: snapshot-based (only if we get a valid calculation)
              if (snapshot7dAgo?.rapid_total !== null && snapshot7dAgo?.rapid_total !== undefined) {
                const calculated = Math.max(0, currRapid - (snapshot7dAgo.rapid_total ?? 0));
                rapid7d = calculated;
                rapid7dMethod = 'snapshot';
              }
              // else: keep previous rapid7d value

              if (snapshot7dAgo?.blitz_total !== null && snapshot7dAgo?.blitz_total !== undefined) {
                const calculated = Math.max(0, currBlitz - (snapshot7dAgo.blitz_total ?? 0));
                blitz7d = calculated;
                blitz7dMethod = 'snapshot';
              }
              // else: keep previous blitz7d value
            }

            // Save snapshot
            await prisma.stats_snapshots.create({
              data: {
                user_id: student.id,
                source: "chesscom",
                rapid_rating: rapidRating,
                blitz_rating: blitzRating,
                puzzle_rating: null,
                rapid_24h: rapid24h,
                blitz_24h: blitz24h,
                rapid_7d: rapid7d,
                blitz_7d: blitz7d,
                puzzle_24h: 0,
                puzzle_7d: 0,
                rapid_total: currRapid,
                blitz_total: currBlitz,
                puzzle_total: 0,
                captured_at: new Date()
              }
            });

            // Build details string
            const method24h = (rapid24hMethod === 'history' || blitz24hMethod === 'history') ? 'history' : 'snapshot';
            const method7d = (rapid7dMethod === 'history' || blitz7dMethod === 'history') ? 'history' : 'snapshot';
            const throttleReason = !canUseHistory && !historyFetchError ? ` throttle(${connection.last_synced_at ? Math.round((now - new Date(connection.last_synced_at).getTime()) / (1000 * 60 * 60) * 10) / 10 : 'never'}h)` : '';
            const errorMarker = historyFetchError ? ' [HISTORY_ERROR]' : '';
            const detailString = `${username} (${connection.platform}): [24h=${method24h}] [7d=${method7d}] R24h=${rapid24h} R7d=${rapid7d} B24h=${blitz24h} B7d=${blitz7d}${throttleReason}${errorMarker}`;
            updates.push(detailString);
          }

        } catch (err) {
          updates.push(`ERROR ${username} (${connection.platform}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const responseData: any = { summary: "Updated", details: updates };
    // Include diagnostics if collected (will be null for non-test users)
    responseData.lichess_debug = lichessDebug;

    return NextResponse.json(responseData);

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
