import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type LichessUser = {
  perfs?: {
    rapid?: { rating?: number };
    blitz?: { rating?: number };
    puzzle?: { rating?: number };
  };
};

type ChessComStats = {
  chess_rapid?: { last?: { rating?: number } };
  chess_blitz?: { last?: { rating?: number } };
  tactics?: {
    highest?: { rating?: number };
    last?: { rating?: number };
  };
};

type ChessComGame = {
  time_class?: string;
  end_time?: number;
};

type ChessComArchive = {
  games?: ChessComGame[];
};

type PlayerRow = {
  id: string;
  nickname: string;
  platform: "lichess" | "chesscom";
  handle: string;
  rapidGames24h: number;
  rapidGames7d: number;
  blitzGames24h: number;
  blitzGames7d: number;
  rapidRating: number | null;
  blitzRating: number | null;
  puzzlesSolved24h: number;
  puzzleRating: number | null;
  homeworkCompletionPct: number;
  lastActiveLabel: string;
};

type PlayerLookupResponse = {
  rows: PlayerRow[];
  debug?: {
    lichess: {
      profileStatus: number | null;
      profileOk: boolean;
      games24hRapidStatus: number | null;
      games7dRapidStatus: number | null;
      games24hBlitzStatus: number | null;
      games7dBlitzStatus: number | null;
      errors: string[];
    };
    chesscom: {
      profileStatus: number | null;
      profileOk: boolean;
      statsStatus: number | null;
      archivesStatus: number | null;
      archiveFetchStatuses: number[];
      errors: string[];
    };
    timingsMs: {
      lichessTotal: number;
      chesscomTotal: number;
      total: number;
    };
  };
};

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function fetchLichessUser(
  username: string,
  debug: { errors: string[] }
): Promise<{ user: LichessUser | null; status: number | null }> {
  try {
    const response = await fetchWithTimeout(
      `https://lichess.org/api/user/${username}`,
      {
        headers: { Accept: "application/json" },
      }
    );
    if (response.ok) {
      const user = await response.json();
      return { user, status: response.status };
    } else {
      debug.errors.push(`Profile fetch failed: ${response.status} ${response.statusText}`);
      return { user: null, status: response.status };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug.errors.push(`Profile fetch error: ${errorMsg}`);
    return { user: null, status: null };
  }
}

async function countLichessGames(
  username: string,
  perfType: "rapid" | "blitz",
  sinceMs: number,
  max: number,
  debug: { errors: string[] }
): Promise<{ count: number; status: number | null }> {
  try {
    const response = await fetchWithTimeout(
      `https://lichess.org/api/games/user/${username}?since=${sinceMs}&max=${max}&perfType=${perfType}&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`,
      {
        headers: { Accept: "application/x-ndjson" },
      }
    );
    if (response.ok) {
      const text = await response.text();
      const count = text.split("\n").filter((line) => line.trim().length > 0).length;
      return { count, status: response.status };
    } else {
      debug.errors.push(`Games ${perfType} since=${sinceMs} failed: ${response.status} ${response.statusText}`);
      return { count: 0, status: response.status };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug.errors.push(`Games ${perfType} since=${sinceMs} error: ${errorMsg}`);
    return { count: 0, status: null };
  }
}

async function fetchChessComProfile(
  username: string,
  debug: { errors: string[] }
): Promise<{ found: boolean; status: number | null }> {
  try {
    const response = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${username}`,
      {
        headers: { Accept: "application/json" },
      }
    );
    if (!response.ok) {
      debug.errors.push(`Profile fetch failed: ${response.status} ${response.statusText}`);
    }
    return { found: response.ok, status: response.status };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug.errors.push(`Profile fetch error: ${errorMsg}`);
    return { found: false, status: null };
  }
}

async function fetchChessComStats(
  username: string,
  debug: { errors: string[] }
): Promise<{ stats: ChessComStats | null; status: number | null }> {
  try {
    const response = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${username}/stats`,
      {
        headers: { Accept: "application/json" },
      }
    );
    if (response.ok) {
      const stats = await response.json();
      return { stats, status: response.status };
    } else {
      debug.errors.push(`Stats fetch failed: ${response.status} ${response.statusText}`);
      return { stats: null, status: response.status };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug.errors.push(`Stats fetch error: ${errorMsg}`);
    return { stats: null, status: null };
  }
}

async function countChessComGames(
  username: string,
  timeClass: "rapid" | "blitz",
  since24h: number,
  since7d: number,
  debug: { errors: string[]; archiveFetchStatuses: number[] }
): Promise<{ games24h: number; games7d: number }> {
  let games24h = 0;
  let games7d = 0;

  try {
    // Fetch archives list
    const archivesResponse = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${username}/games/archives`,
      {
        headers: { Accept: "application/json" },
      }
    );

    if (!archivesResponse.ok) {
      debug.errors.push(`Archives list fetch failed: ${archivesResponse.status} ${archivesResponse.statusText}`);
      return { games24h: 0, games7d: 0 };
    }

    const archivesData = await archivesResponse.json();
    const archives = archivesData.archives || [];
    // Take last 2 archives only
    const recentArchives = archives.slice(-2);

    // Fetch each archive
    for (const archiveUrl of recentArchives) {
      try {
        const archiveResponse = await fetchWithTimeout(archiveUrl, {
          headers: { Accept: "application/json" },
        });
        debug.archiveFetchStatuses.push(archiveResponse.status);
        
        if (archiveResponse.ok) {
          const archiveData: ChessComArchive = await archiveResponse.json();
          const games = archiveData.games || [];

          for (const game of games) {
            if (game.time_class === timeClass) {
              const endTime = game.end_time;
              if (endTime) {
                const endTimeMs = endTime * 1000;
                if (endTimeMs >= since24h) {
                  games24h++;
                  games7d++;
                } else if (endTimeMs >= since7d) {
                  games7d++;
                }
              }
            }
          }
        } else {
          debug.errors.push(`Archive ${archiveUrl} fetch failed: ${archiveResponse.status} ${archiveResponse.statusText}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        debug.errors.push(`Archive ${archiveUrl} fetch error: ${errorMsg}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug.errors.push(`Archives processing error: ${errorMsg}`);
  }

  return { games24h, games7d };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const username = searchParams.get("username");
  const debugMode = searchParams.get("debug") === "1";

  if (!username || !username.trim()) {
    return NextResponse.json(
      { error: "Username parameter is required" },
      { status: 400 }
    );
  }

  const normalizedUsername = username.trim();
  const displayNickname = normalizedUsername;

  // Calculate time windows
  const now = Date.now();
  const since24h = now - 24 * 60 * 60 * 1000;
  const since7d = now - 7 * 24 * 60 * 60 * 1000;

  const totalStartTime = Date.now();
  const debug = debugMode
    ? {
        lichess: {
          profileStatus: null as number | null,
          profileOk: false,
          games24hRapidStatus: null as number | null,
          games7dRapidStatus: null as number | null,
          games24hBlitzStatus: null as number | null,
          games7dBlitzStatus: null as number | null,
          errors: [] as string[],
        },
        chesscom: {
          profileStatus: null as number | null,
          profileOk: false,
          statsStatus: null as number | null,
          archivesStatus: null as number | null,
          archiveFetchStatuses: [] as number[],
          errors: [] as string[],
        },
        timingsMs: {
          lichessTotal: 0,
          chesscomTotal: 0,
          total: 0,
        },
      }
    : null;

  // Lichess lookup
  const lichessStartTime = Date.now();
  const { user: lichessUser, status: lichessProfileStatus } = debug
    ? await fetchLichessUser(normalizedUsername.toLowerCase(), debug.lichess)
    : await fetchLichessUser(normalizedUsername.toLowerCase(), { errors: [] });
  
  if (debug) {
    debug.lichess.profileStatus = lichessProfileStatus;
    debug.lichess.profileOk = lichessUser !== null;
  }

  let lichessHandle: string | null = null;
  let lichessRapidRating: number | null = null;
  let lichessBlitzRating: number | null = null;
  let lichessPuzzleRating: number | null = null;
  let lichessRapid24h = 0;
  let lichessRapid7d = 0;
  let lichessBlitz24h = 0;
  let lichessBlitz7d = 0;

  if (lichessUser) {
    lichessHandle = normalizedUsername.toLowerCase();
    lichessRapidRating = lichessUser.perfs?.rapid?.rating ?? null;
    lichessBlitzRating = lichessUser.perfs?.blitz?.rating ?? null;
    lichessPuzzleRating = lichessUser.perfs?.puzzle?.rating ?? null;

    // Count games
    const rapid24hResult = debug
      ? await countLichessGames(
          lichessHandle,
          "rapid",
          since24h,
          200,
          debug.lichess
        )
      : await countLichessGames(lichessHandle, "rapid", since24h, 200, { errors: [] });
    lichessRapid24h = rapid24hResult.count;
    if (debug) {
      debug.lichess.games24hRapidStatus = rapid24hResult.status;
    }

    const rapid7dResult = debug
      ? await countLichessGames(
          lichessHandle,
          "rapid",
          since7d,
          400,
          debug.lichess
        )
      : await countLichessGames(lichessHandle, "rapid", since7d, 400, { errors: [] });
    lichessRapid7d = rapid7dResult.count;
    if (debug) {
      debug.lichess.games7dRapidStatus = rapid7dResult.status;
    }

    const blitz24hResult = debug
      ? await countLichessGames(
          lichessHandle,
          "blitz",
          since24h,
          200,
          debug.lichess
        )
      : await countLichessGames(lichessHandle, "blitz", since24h, 200, { errors: [] });
    lichessBlitz24h = blitz24hResult.count;
    if (debug) {
      debug.lichess.games24hBlitzStatus = blitz24hResult.status;
    }

    const blitz7dResult = debug
      ? await countLichessGames(
          lichessHandle,
          "blitz",
          since7d,
          400,
          debug.lichess
        )
      : await countLichessGames(lichessHandle, "blitz", since7d, 400, { errors: [] });
    lichessBlitz7d = blitz7dResult.count;
    if (debug) {
      debug.lichess.games7dBlitzStatus = blitz7dResult.status;
    }
  }

  if (debug) {
    debug.timingsMs.lichessTotal = Date.now() - lichessStartTime;
  }

  // Chess.com lookup
  const chesscomStartTime = Date.now();
  const { found: chessComFound, status: chessComProfileStatus } = debug
    ? await fetchChessComProfile(normalizedUsername, debug.chesscom)
    : await fetchChessComProfile(normalizedUsername, { errors: [] });
  
  if (debug) {
    debug.chesscom.profileStatus = chessComProfileStatus;
    debug.chesscom.profileOk = chessComFound;
  }

  let chesscomHandle: string | null = null;
  let chesscomRapidRating: number | null = null;
  let chesscomBlitzRating: number | null = null;
  let chesscomPuzzleRating: number | null = null;
  let chesscomRapid24h = 0;
  let chesscomRapid7d = 0;
  let chesscomBlitz24h = 0;
  let chesscomBlitz7d = 0;

  if (chessComFound) {
    chesscomHandle = normalizedUsername;

    const { stats: chessComStats, status: chessComStatsStatus } = debug
      ? await fetchChessComStats(normalizedUsername, debug.chesscom)
      : await fetchChessComStats(normalizedUsername, { errors: [] });
    
    if (debug) {
      debug.chesscom.statsStatus = chessComStatsStatus;
    }

    if (chessComStats) {
      chesscomRapidRating = chessComStats.chess_rapid?.last?.rating ?? null;
      chesscomBlitzRating = chessComStats.chess_blitz?.last?.rating ?? null;
      chesscomPuzzleRating =
        chessComStats.tactics?.highest?.rating ??
        chessComStats.tactics?.last?.rating ??
        null;
    }

    // Fetch archives list status
    try {
      const archivesTestResponse = await fetchWithTimeout(
        `https://api.chess.com/pub/player/${normalizedUsername}/games/archives`,
        {
          headers: { Accept: "application/json" },
        }
      );
      if (debug) {
        debug.chesscom.archivesStatus = archivesTestResponse.status;
      }
    } catch (error) {
      // Already handled in countChessComGames
    }

    // Count games
    const rapidCounts = debug
      ? await countChessComGames(
          normalizedUsername,
          "rapid",
          since24h,
          since7d,
          debug.chesscom
        )
      : await countChessComGames(
          normalizedUsername,
          "rapid",
          since24h,
          since7d,
          { errors: [], archiveFetchStatuses: [] }
        );
    chesscomRapid24h = rapidCounts.games24h;
    chesscomRapid7d = rapidCounts.games7d;

    const blitzCounts = debug
      ? await countChessComGames(
          normalizedUsername,
          "blitz",
          since24h,
          since7d,
          debug.chesscom
        )
      : await countChessComGames(
          normalizedUsername,
          "blitz",
          since24h,
          since7d,
          { errors: [], archiveFetchStatuses: [] }
        );
    chesscomBlitz24h = blitzCounts.games24h;
    chesscomBlitz7d = blitzCounts.games7d;
  }

  if (debug) {
    debug.timingsMs.chesscomTotal = Date.now() - chesscomStartTime;
    debug.timingsMs.total = Date.now() - totalStartTime;
  }

  // Check if user found on either platform
  if (!lichessUser && !chessComFound) {
    const errorResponse: { error: string; debug?: typeof debug } = {
      error: "User not found on Lichess or Chess.com",
    };
    if (debug) {
      errorResponse.debug = debug;
    }
    return NextResponse.json(errorResponse, { status: 404 });
  }

  // Create rows for each platform found
  const rows: PlayerRow[] = [];

  // Lichess row
  if (lichessUser) {
    const lichessGames24h = lichessRapid24h + lichessBlitz24h;
    const lichessGames7d = lichessRapid7d + lichessBlitz7d;
    let lichessLastActive = "—";
    if (lichessGames24h > 0) {
      lichessLastActive = "active_24h";
    } else if (lichessGames7d > 0) {
      lichessLastActive = "active_7d";
    }

    rows.push({
      id: crypto.randomUUID(),
      nickname: displayNickname,
      platform: "lichess",
      handle: lichessHandle!,
      rapidGames24h: lichessRapid24h,
      rapidGames7d: lichessRapid7d,
      blitzGames24h: lichessBlitz24h,
      blitzGames7d: lichessBlitz7d,
      rapidRating: lichessRapidRating,
      blitzRating: lichessBlitzRating,
      puzzlesSolved24h: 0, // MVP placeholder
      puzzleRating: lichessPuzzleRating,
      homeworkCompletionPct: 0, // MVP placeholder
      lastActiveLabel: lichessLastActive,
    });
  }

  // Chess.com row
  if (chessComFound) {
    const chesscomGames24h = chesscomRapid24h + chesscomBlitz24h;
    const chesscomGames7d = chesscomRapid7d + chesscomBlitz7d;
    let chesscomLastActive = "—";
    if (chesscomGames24h > 0) {
      chesscomLastActive = "active_24h";
    } else if (chesscomGames7d > 0) {
      chesscomLastActive = "active_7d";
    }

    rows.push({
      id: crypto.randomUUID(),
      nickname: displayNickname,
      platform: "chesscom",
      handle: chesscomHandle!,
      rapidGames24h: chesscomRapid24h,
      rapidGames7d: chesscomRapid7d,
      blitzGames24h: chesscomBlitz24h,
      blitzGames7d: chesscomBlitz7d,
      rapidRating: chesscomRapidRating,
      blitzRating: chesscomBlitzRating,
      puzzlesSolved24h: 0, // MVP placeholder
      puzzleRating: chesscomPuzzleRating,
      homeworkCompletionPct: 0, // MVP placeholder
      lastActiveLabel: chesscomLastActive,
    });
  }

  // Save to Supabase database
  try {
    const supabase = await createClient();

    for (const row of rows) {
      try {
        // Check if platform_connection already exists
        const { data: existingConnection } = await supabase
          .from("platform_connections")
          .select("user_id, id")
          .eq("platform", row.platform)
          .eq("platform_username", row.handle)
          .maybeSingle();

        let userId: string;

        if (existingConnection) {
          // Update existing connection
          userId = existingConnection.user_id;
          await supabase
            .from("platform_connections")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", existingConnection.id);
        } else {
          // Create new profile and platform_connection
          userId = row.id;

          // Insert profile
          await supabase.from("profiles").insert({
            id: userId,
            full_name: row.nickname,
            role: "student",
          });

          // Insert platform_connection
          await supabase.from("platform_connections").insert({
            user_id: userId,
            platform: row.platform,
            platform_username: row.handle,
            last_synced_at: new Date().toISOString(),
          });
        }

        // Always insert stats_snapshot
        const totalGames = row.rapidGames24h + row.blitzGames24h;
        await supabase.from("stats_snapshots").insert({
          user_id: userId,
          source: row.platform,
          rating_rapid: row.rapidRating,
          rating_blitz: row.blitzRating,
          puzzle_rating: row.puzzleRating,
          games_played_24h: totalGames,
          games_played_7d: row.rapidGames7d + row.blitzGames7d,
          created_at: new Date().toISOString(),
        });

        console.log(`Saved to DB: ${row.nickname} (${row.platform})`);
      } catch (rowError) {
        console.error(`Error saving row for ${row.nickname}:`, rowError);
        // Continue with next row
      }
    }
  } catch (dbError) {
    console.error("Error saving to Supabase:", dbError);
    // Continue - don't break the API response
  }

  const response: PlayerLookupResponse = {
    rows,
  };

  if (debug) {
    response.debug = debug;
  }

  return NextResponse.json(response);
}
