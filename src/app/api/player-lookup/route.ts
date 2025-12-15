import { NextRequest, NextResponse } from "next/server";

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

type PlayerLookupResult = {
  id: string;
  nickname: string;
  lichessHandle: string | null;
  chesscomHandle: string | null;
  rapidGames24h: number;
  rapidGames7d: number;
  blitzGames24h: number;
  blitzGames7d: number;
  rapidRating: number | null;
  blitzRating: number | null;
  puzzlesSolved24h: number;
  puzzlesSolved7d: number;
  puzzleRating: number | null;
  homeworkCompletionPct: number;
  lastActiveLabel: string;
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

async function fetchLichessUser(username: string): Promise<LichessUser | null> {
  try {
    const response = await fetchWithTimeout(
      `https://lichess.org/api/user/${username}`,
      {
        headers: { Accept: "application/json" },
      }
    );
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    // Treat as not found
  }
  return null;
}

async function countLichessGames(
  username: string,
  perfType: "rapid" | "blitz",
  sinceMs: number,
  max: number
): Promise<number> {
  try {
    const response = await fetchWithTimeout(
      `https://lichess.org/api/games/user/${username}?since=${sinceMs}&max=${max}&perfType=${perfType}&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`,
      {
        headers: { Accept: "application/x-ndjson" },
      }
    );
    if (response.ok) {
      const text = await response.text();
      // Count non-empty lines (NDJSON format)
      const lines = text.trim().split("\n").filter((line) => line.trim());
      return lines.length;
    }
  } catch (error) {
    // Treat as 0
  }
  return 0;
}

async function fetchChessComProfile(username: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${username}`,
      {
        headers: { Accept: "application/json" },
      }
    );
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function fetchChessComStats(
  username: string
): Promise<ChessComStats | null> {
  try {
    const response = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${username}/stats`,
      {
        headers: { Accept: "application/json" },
      }
    );
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    // Treat as not found
  }
  return null;
}

async function countChessComGames(
  username: string,
  timeClass: "rapid" | "blitz",
  since24h: number,
  since7d: number
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
        if (archiveResponse.ok) {
          const archiveData: ChessComArchive = await archiveResponse.json();
          const games = archiveData.games || [];

          for (const game of games) {
            if (
              game.time_class === timeClass ||
              (timeClass === "rapid" && game.time_class === "chess_rapid") ||
              (timeClass === "blitz" && game.time_class === "chess_blitz")
            ) {
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
        }
      } catch (error) {
        // Continue with next archive
      }
    }
  } catch (error) {
    // Return 0 counts
  }

  return { games24h, games7d };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const username = searchParams.get("username");

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

  // Lichess lookup
  const lichessUser = await fetchLichessUser(normalizedUsername.toLowerCase());
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
    lichessRapid24h = await countLichessGames(
      lichessHandle,
      "rapid",
      since24h,
      200
    );
    lichessRapid7d = await countLichessGames(
      lichessHandle,
      "rapid",
      since7d,
      400
    );
    lichessBlitz24h = await countLichessGames(
      lichessHandle,
      "blitz",
      since24h,
      200
    );
    lichessBlitz7d = await countLichessGames(
      lichessHandle,
      "blitz",
      since7d,
      400
    );
  }

  // Chess.com lookup
  const chessComFound = await fetchChessComProfile(normalizedUsername);
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

    const chessComStats = await fetchChessComStats(normalizedUsername);
    if (chessComStats) {
      chesscomRapidRating = chessComStats.chess_rapid?.last?.rating ?? null;
      chesscomBlitzRating = chessComStats.chess_blitz?.last?.rating ?? null;
      chesscomPuzzleRating =
        chessComStats.tactics?.highest?.rating ??
        chessComStats.tactics?.last?.rating ??
        null;
    }

    // Count games
    const rapidCounts = await countChessComGames(
      normalizedUsername,
      "rapid",
      since24h,
      since7d
    );
    chesscomRapid24h = rapidCounts.games24h;
    chesscomRapid7d = rapidCounts.games7d;

    const blitzCounts = await countChessComGames(
      normalizedUsername,
      "blitz",
      since24h,
      since7d
    );
    chesscomBlitz24h = blitzCounts.games24h;
    chesscomBlitz7d = blitzCounts.games7d;
  }

  // Check if user found on either platform
  if (!lichessUser && !chessComFound) {
    return NextResponse.json(
      { error: "User not found on Lichess or Chess.com" },
      { status: 404 }
    );
  }

  // Combine results
  const rapidRating = lichessRapidRating ?? chesscomRapidRating ?? null;
  const blitzRating = lichessBlitzRating ?? chesscomBlitzRating ?? null;
  const puzzleRating = lichessPuzzleRating ?? chesscomPuzzleRating ?? null;

  const rapidGames24h = lichessRapid24h + chesscomRapid24h;
  const rapidGames7d = lichessRapid7d + chesscomRapid7d;
  const blitzGames24h = lichessBlitz24h + chesscomBlitz24h;
  const blitzGames7d = lichessBlitz7d + chesscomBlitz7d;

  // Compute lastActiveLabel
  let lastActiveLabel = "—";
  if (rapidGames24h + blitzGames24h > 0) {
    lastActiveLabel = "active <24h";
  } else if (rapidGames7d + blitzGames7d > 0) {
    lastActiveLabel = "active <7d";
  }

  const result: PlayerLookupResult = {
    id: crypto.randomUUID(),
    nickname: displayNickname,
    lichessHandle,
    chesscomHandle,
    rapidGames24h,
    rapidGames7d,
    blitzGames24h,
    blitzGames7d,
    rapidRating,
    blitzRating,
    puzzlesSolved24h: 0, // MVP placeholder
    puzzlesSolved7d: 0, // MVP placeholder
    puzzleRating,
    homeworkCompletionPct: 0, // MVP placeholder
    lastActiveLabel,
  };

  return NextResponse.json(result);
}

