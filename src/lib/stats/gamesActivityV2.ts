/**
 * Games Activity V2 - Pure computation module for game counts
 * No database writes, no Next.js dependencies
 */

export type GamesCounts = {
  rapid24h: number;
  rapid7d: number;
  blitz24h: number;
  blitz7d: number;
  computedAt: string; // ISO string
};

interface LichessGame {
  lastMoveAt?: number;
  [key: string]: unknown;
}

interface ChessComGame {
  time_class?: string;
  end_time?: number;
  [key: string]: unknown;
}

interface ChessComArchive {
  games?: ChessComGame[];
  [key: string]: unknown;
}

interface ChessComArchivesResponse {
  archives?: string[];
  [key: string]: unknown;
}

// ============================================================================
// Helper Utilities
// ============================================================================

/**
 * Convert Date to milliseconds since epoch (UTC)
 */
export function msSince(date: Date): number {
  return date.getTime();
}

/**
 * Check if a timestamp (ms) is within the window (>= sinceMs)
 */
export function isWithin(ms: number, sinceMs: number): boolean {
  return ms >= sinceMs;
}

/**
 * Safely parse JSON, return null on error
 */
export function safeJson<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Safely parse a single NDJSON line, return null on error
 */
export function safeNdjsonLineParse<T = unknown>(line: string): T | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return safeJson<T>(trimmed);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get UTC time windows based on now
 */
function getTimeWindows(now: Date): { since24hMs: number; since7dMs: number } {
  const since24hMs = now.getTime() - 24 * 60 * 60 * 1000;
  const since7dMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return { since24hMs, since7dMs };
}

/**
 * Get archive months to fetch for Chess.com (current, previous, and possibly one more if early in month)
 */
function getArchiveMonthsToFetch(now: Date): string[] {
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1; // getUTCMonth returns 0-11
  const currentDay = now.getUTCDate();

  const months: string[] = [];

  // Current month (YYYY/MM format)
  months.push(`${currentYear}/${String(currentMonth).padStart(2, '0')}`);

  // Previous month
  let prevYear = currentYear;
  let prevMonth = currentMonth - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear--;
  }
  months.push(`${prevYear}/${String(prevMonth).padStart(2, '0')}`);

  // If early in the month (first 7 days), also fetch the month before previous
  // This ensures we cover games from up to 7 days ago even if they're in the previous month
  if (currentDay <= 7) {
    let prevPrevYear = prevYear;
    let prevPrevMonth = prevMonth - 1;
    if (prevPrevMonth === 0) {
      prevPrevMonth = 12;
      prevPrevYear--;
    }
    months.push(`${prevPrevYear}/${String(prevPrevMonth).padStart(2, '0')}`);
  }

  return months;
}

/**
 * Filter archive URLs to only include the months we need
 */
function filterArchiveUrls(archives: string[], monthsToFetch: string[]): string[] {
  return archives.filter((url) => {
    // URL format: https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM}
    // Extract YYYY/MM from URL
    const match = url.match(/\/games\/(\d{4})\/(\d{2})/);
    if (!match) return false;
    const monthKey = `${match[1]}/${match[2]}`;
    return monthsToFetch.includes(monthKey);
  });
}

// ============================================================================
// Lichess Implementation
// ============================================================================

/**
 * Compute game counts from Lichess
 */
export async function computeFromLichess(params: {
  username: string;
  now?: Date;
  token?: string; // optional, for higher rate limits; default from env if present
}): Promise<GamesCounts> {
  const { username, now = new Date(), token } = params;
  const { since24hMs, since7dMs } = getTimeWindows(now);

  // Use token from params, or fallback to env variable if available
  const authToken = token || (typeof process !== 'undefined' && process.env?.LICHESS_TOKEN) || undefined;

  const headers: Record<string, string> = {
    Accept: 'application/x-ndjson',
    'User-Agent': 'RoboChess/1.0',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  let rapid24h = 0;
  let rapid7d = 0;
  let blitz24h = 0;
  let blitz7d = 0;

  // Fetch rapid stats
  const rapidCounts = await fetchLichessPerfType(username, 'rapid', since24hMs, since7dMs, headers);
  rapid24h = rapidCounts.games24h;
  rapid7d = rapidCounts.games7d;

  // Small sleep between calls (200-400ms for rate limiting)
  await sleep(300);

  // Fetch blitz stats
  const blitzCounts = await fetchLichessPerfType(username, 'blitz', since24hMs, since7dMs, headers);
  blitz24h = blitzCounts.games24h;
  blitz7d = blitzCounts.games7d;

  return {
    rapid24h,
    rapid7d,
    blitz24h,
    blitz7d,
    computedAt: now.toISOString(),
  };
}

/**
 * Fetch and count games for a specific perf type from Lichess
 * Throws on fetch failure or non-ok response
 */
async function fetchLichessPerfType(
  username: string,
  perfType: 'rapid' | 'blitz',
  since24hMs: number,
  since7dMs: number,
  headers: Record<string, string>
): Promise<{ games24h: number; games7d: number }> {
  let games24h = 0;
  let games7d = 0;

  const url = `https://lichess.org/api/games/user/${username}?since=${since7dMs}&max=400&perfType=${perfType}&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`;

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
    // Throw on fetch failure (timeout/network error)
    throw new Error(
      `Lichess ${perfType} fetch failed for ${username}: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
    );
  }

  // Throw on non-ok response
  if (!response.ok) {
    throw new Error(
      `Lichess ${perfType} API returned ${response.status} ${response.statusText} for ${username}`
    );
  }

  // Parse response body
  const text = await response.text();
  const lines = text.split('\n').filter((line) => line.trim().length > 0);

  // Parse each line defensively (skip malformed lines, but don't throw)
  for (const line of lines) {
    const game = safeNdjsonLineParse<LichessGame>(line);
    if (game?.lastMoveAt && typeof game.lastMoveAt === 'number') {
      const gameEndMs = game.lastMoveAt;
      if (isWithin(gameEndMs, since24hMs)) {
        games24h++;
        games7d++;
      } else if (isWithin(gameEndMs, since7dMs)) {
        games7d++;
      }
    }
  }

  return { games24h, games7d };
}

// ============================================================================
// Chess.com Implementation
// ============================================================================

/**
 * Compute game counts from Chess.com
 * Throws on fetch failure or non-ok response
 */
export async function computeFromChessCom(params: {
  username: string;
  now?: Date;
}): Promise<GamesCounts> {
  const { username, now = new Date() } = params;
  const { since24hMs, since7dMs } = getTimeWindows(now);

  let rapid24h = 0;
  let rapid7d = 0;
  let blitz24h = 0;
  let blitz7d = 0;

  // Fetch archives list
  const archivesUrl = `https://api.chess.com/pub/player/${username}/games/archives`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

  let archivesResponse: Response;
  try {
    archivesResponse = await fetch(archivesUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RoboChess/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
  } catch (fetchError) {
    clearTimeout(timeoutId);
    // Throw on fetch failure (timeout/network error)
    throw new Error(
      `Chess.com archives fetch failed for ${username}: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
    );
  }

  // Throw on non-ok response
  if (!archivesResponse.ok) {
    throw new Error(
      `Chess.com archives API returned ${archivesResponse.status} ${archivesResponse.statusText} for ${username}`
    );
  }

  const archivesData = safeJson<ChessComArchivesResponse>(await archivesResponse.text());
  const allArchives = archivesData?.archives || [];

  // Determine which months we need to fetch
  const monthsToFetch = getArchiveMonthsToFetch(now);
  const archivesToFetch = filterArchiveUrls(allArchives, monthsToFetch);

  // Process each archive (skip failed archive fetches, but don't throw)
  for (const archiveUrl of archivesToFetch) {
    try {
      const archiveController = new AbortController();
      const archiveTimeout = setTimeout(() => archiveController.abort(), 15000);

      const archiveResponse = await fetch(archiveUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'RoboChess/1.0',
        },
        signal: archiveController.signal,
      });

      clearTimeout(archiveTimeout);

      if (archiveResponse.ok) {
        const archiveData = safeJson<ChessComArchive>(await archiveResponse.text());
        const games = archiveData?.games || [];

        // Count games by time_class and end_time
        for (const game of games) {
          if (
            game.time_class &&
            typeof game.time_class === 'string' &&
            (game.time_class === 'rapid' || game.time_class === 'blitz') &&
            game.end_time &&
            typeof game.end_time === 'number'
          ) {
            const endMs = game.end_time * 1000; // Convert seconds to milliseconds

            if (game.time_class === 'rapid') {
              if (isWithin(endMs, since24hMs)) {
                rapid24h++;
                rapid7d++;
              } else if (isWithin(endMs, since7dMs)) {
                rapid7d++;
              }
            } else if (game.time_class === 'blitz') {
              if (isWithin(endMs, since24hMs)) {
                blitz24h++;
                blitz7d++;
              } else if (isWithin(endMs, since7dMs)) {
                blitz7d++;
              }
            }
          }
        }
      }
      // If individual archive fails, skip it but continue with others
    } catch (archiveError) {
      // Skip failed archive fetch, continue with others
    }
  }

  return {
    rapid24h,
    rapid7d,
    blitz24h,
    blitz7d,
    computedAt: now.toISOString(),
  };
}

