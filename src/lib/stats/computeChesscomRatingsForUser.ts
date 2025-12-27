/**
 * Compute Chess.com ratings for a user (public API, no OAuth required)
 * @param username - Chess.com username
 * @returns Ratings object with rapid, blitz, and puzzle ratings
 */
export async function computeChesscomRatingsForUser(
  username: string
): Promise<{
  rapidRating: number | null;
  blitzRating: number | null;
  puzzleRating: number | null;
}> {
  if (!username || username.trim().length === 0) {
    return {
      rapidRating: null,
      blitzRating: null,
      puzzleRating: null,
    };
  }

  const normalizedUsername = username.trim();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(
      `https://api.chess.com/pub/player/${normalizedUsername}/stats`,
      {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RoboChess/1.0',
        },
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        return {
          rapidRating: null,
          blitzRating: null,
          puzzleRating: null,
        };
      }
      // For other errors, return nulls without throwing
      return {
        rapidRating: null,
        blitzRating: null,
        puzzleRating: null,
      };
    }

    const statsData = await response.json();

    return {
      rapidRating: statsData?.chess_rapid?.last?.rating ?? null,
      blitzRating: statsData?.chess_blitz?.last?.rating ?? null,
      puzzleRating: statsData?.tactics?.highest?.rating ?? null, // Note: Chess.com uses 'highest' not 'last' for tactics
    };
  } catch (error) {
    // On any error (timeout, network, parse), return nulls without throwing
    return {
      rapidRating: null,
      blitzRating: null,
      puzzleRating: null,
    };
  }
}

