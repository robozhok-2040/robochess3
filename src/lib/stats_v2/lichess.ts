import { Perf, DiagnosticInfo } from './types';

/**
 * Fetch Lichess games count from NDJSON export with diagnostics
 */
export async function fetchLichessGamesCount(
  username: string,
  perf: Perf,
  since24hMs: number,
  since7dMs: number
): Promise<{ games24h: number; games7d: number; diagnostics: DiagnosticInfo }> {
  const diagnostics: DiagnosticInfo = {
    url: '',
    status: null,
    contentType: null,
    bytes: null,
    lines: null,
    sampleLines: [],
  };

  let games24h = 0;
  let games7d = 0;

  try {
    // Fetch 7d window (covers both 24h and 7d)
    const url = `https://lichess.org/api/games/user/${username}?since=${since7dMs}&max=400&perfType=${perf}&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`;
    diagnostics.url = url;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/x-ndjson',
          'User-Agent': 'RoboChess/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      diagnostics.status = response.status;
      diagnostics.contentType = response.headers.get('content-type') || null;

      if (response.ok) {
        // Read response body exactly once
        const text = await response.text();

        // Calculate bytes using Buffer.byteLength
        diagnostics.bytes = Buffer.byteLength(text, 'utf8');

        // Count non-empty lines
        const lines = text.split('\n').filter((line) => line.trim().length > 0);
        diagnostics.lines = lines.length;

        // Get first 2 non-empty lines, truncate to 200 chars each
        if (lines.length > 0) {
          diagnostics.sampleLines = lines.slice(0, 2).map((line) =>
            line.length > 200 ? line.substring(0, 200) + '...' : line
          );
        }

        // Parse each line as JSON to get game timestamp
        for (const line of lines) {
          try {
            const game = JSON.parse(line);
            // Lichess games have 'lastMoveAt' timestamp in milliseconds
            if (game.lastMoveAt) {
              const gameEndMs = game.lastMoveAt;
              if (gameEndMs >= since24hMs) {
                games24h++;
                games7d++;
              } else if (gameEndMs >= since7dMs) {
                games7d++;
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      } else {
        // Non-OK status - try to read body for diagnostics
        try {
          const text = await response.text();
          diagnostics.bytes = Buffer.byteLength(text, 'utf8');
          if (text.length > 0) {
            const truncated = text.length > 200 ? text.substring(0, 200) + '...' : text;
            diagnostics.sampleLines = [truncated];
          }
        } catch (e) {
          // Ignore body read errors
        }
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      diagnostics.error = fetchError instanceof Error ? fetchError.message : String(fetchError);
    }
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : String(error);
  }

  return { games24h, games7d, diagnostics };
}

