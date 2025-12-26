export type LichessPuzzleCounts = {
  solved24h: number;
  solved7d: number;
  truncated: boolean;
};

/**
 * Fetch Lichess puzzle activity counts for the authenticated user
 * @param token - Lichess OAuth token
 * @param now - Current timestamp (defaults to new Date())
 * @returns Puzzle counts for 24h and 7d windows
 */
export async function fetchLichessPuzzleCounts(
  token: string,
  now: Date = new Date()
): Promise<LichessPuzzleCounts> {
  // Validate token
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('LICHESS_TOKEN_MISSING');
  }

  const since24hMs = now.getTime() - 24 * 60 * 60 * 1000;
  const since7dMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  // Fetch puzzle activity
  const url = 'https://lichess.org/api/user/puzzle-activity?max=1000';
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/x-ndjson',
    },
  });

  // Handle auth errors
  if (response.status === 401 || response.status === 403) {
    throw new Error('LICHESS_TOKEN_INVALID');
  }

  // Handle other errors
  if (!response.ok) {
    throw new Error('LICHESS_PUZZLE_ACTIVITY_FETCH_FAILED');
  }

  // Parse response
  const text = await response.text();
  const lines = text.split('\n').filter((line) => line.trim().length > 0);

  let solved24h = 0;
  let solved7d = 0;
  let parsedCount = 0;
  let stoppedEarly = false;

  for (const line of lines) {
    parsedCount++;

    try {
      const entry = JSON.parse(line);

      // Extract timestamp (try multiple field names)
      let timestampMs: number | null = null;

      const timestampFields = ['date', 'ts', 'timestamp', 'createdAt'];
      for (const field of timestampFields) {
        const value = entry[field];
        if (value != null && typeof value === 'number' && value > 0) {
          // If value < 1e12, treat as seconds and convert to ms
          timestampMs = value < 1e12 ? value * 1000 : value;
          break;
        }
      }

      if (timestampMs === null || timestampMs < since7dMs) {
        // No valid timestamp or older than 7d window - stop processing
        stoppedEarly = true;
        break;
      }

      // Extract "solved" status (check multiple patterns)
      let isSolved = false;

      if (entry.win === true || entry.success === true) {
        isSolved = true;
      } else if (
        entry.result === 'win' ||
        entry.result === 'success'
      ) {
        isSolved = true;
      } else if (entry.round?.win === true || entry.round?.success === true) {
        isSolved = true;
      }

      // Count within windows
      if (isSolved) {
        if (timestampMs >= since24hMs) {
          solved24h++;
          solved7d++;
        } else if (timestampMs >= since7dMs) {
          solved7d++;
        }
      }
    } catch (parseError) {
      // Skip malformed lines
      continue;
    }
  }

  const truncated = !stoppedEarly && parsedCount >= 1000;

  return {
    solved24h,
    solved7d,
    truncated,
  };
}

