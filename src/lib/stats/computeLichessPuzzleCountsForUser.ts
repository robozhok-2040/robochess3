import { prisma } from '@/lib/prisma';

export type LichessPuzzleSyncStatus =
  | 'OK'
  | 'NO_CONNECTION'
  | 'ERROR';

export type LichessPuzzleSyncResult = {
  status: LichessPuzzleSyncStatus;
  puzzleTotal: number | null;
  error?: string;
};

/**
 * Compute Lichess puzzle total count for a user (public API, no OAuth required)
 * @param userId - User ID
 * @returns Sync result with puzzle_total or error status
 */
export async function computeLichessPuzzleCountsForUser(
  userId: string
): Promise<LichessPuzzleSyncResult> {
  // Validate userId
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return {
      status: 'ERROR',
      puzzleTotal: null,
      error: 'USER_ID_MISSING',
    };
  }

  // Query platform connection to get username
  const connection = await prisma.platform_connections.findUnique({
    where: {
      user_id_platform: {
        user_id: userId,
        platform: 'lichess',
      },
    },
    select: {
      platform_username: true,
    },
  });

  // Check if connection exists
  if (!connection) {
    return {
      status: 'NO_CONNECTION',
      puzzleTotal: null,
    };
  }

  // Check if username exists
  if (!connection.platform_username || connection.platform_username.trim().length === 0) {
    return {
      status: 'ERROR',
      puzzleTotal: null,
      error: 'USERNAME_MISSING',
    };
  }

  const username = connection.platform_username.trim().toLowerCase();

  // Fetch public user JSON from Lichess
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(`https://lichess.org/api/user/${username}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        return {
          status: 'ERROR',
          puzzleTotal: null,
          error: `User not found: ${username}`,
        };
      }
      throw new Error(`Lichess API returned ${response.status} ${response.statusText} for ${username}`);
    }

    const userData = await response.json();

    // Extract puzzle total from perfs.puzzle.games
    let puzzleTotal: number | null = null;
    if (userData?.perfs?.puzzle?.games !== undefined) {
      const gamesValue = userData.perfs.puzzle.games;
      if (typeof gamesValue === 'number' && gamesValue >= 0) {
        puzzleTotal = gamesValue;
      }
    }

    return {
      status: 'OK',
      puzzleTotal,
    };
  } catch (fetchError) {
    const errorMessage =
      fetchError instanceof Error ? fetchError.message : String(fetchError);

    // Handle abort (timeout)
    if (fetchError instanceof Error && fetchError.name === 'AbortError') {
      return {
        status: 'ERROR',
        puzzleTotal: null,
        error: 'Request timeout',
      };
    }

    // Generic error
    return {
      status: 'ERROR',
      puzzleTotal: null,
      error: errorMessage,
    };
  }
}
