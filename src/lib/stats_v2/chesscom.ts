import { Perf, DiagnosticInfo } from './types';

interface ChessComGame {
  time_class?: string;
  end_time?: number;
  [key: string]: any;
}

interface ChessComArchive {
  games?: ChessComGame[];
  [key: string]: any;
}

/**
 * Fetch Chess.com games count from archives with diagnostics
 */
export async function fetchChesscomGamesCount(
  username: string,
  since24hMs: number,
  since7dMs: number
): Promise<{ rapid: { games24h: number; games7d: number; diagnostics: DiagnosticInfo }; blitz: { games24h: number; games7d: number; diagnostics: DiagnosticInfo } }> {
  const rapidDiagnostics: DiagnosticInfo = {
    url: '',
    status: null,
    contentType: null,
    bytes: null,
    lines: null,
    sampleLines: [],
  };

  const blitzDiagnostics: DiagnosticInfo = {
    url: '',
    status: null,
    contentType: null,
    bytes: null,
    lines: null,
    sampleLines: [],
  };

  let rapid24h = 0;
  let rapid7d = 0;
  let blitz24h = 0;
  let blitz7d = 0;

  try {
    // Fetch archives list
    const archivesUrl = `https://api.chess.com/pub/player/${username}/games/archives`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const archivesResponse = await fetch(archivesUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'RoboChess/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!archivesResponse.ok) {
        rapidDiagnostics.status = archivesResponse.status;
        blitzDiagnostics.status = archivesResponse.status;
        rapidDiagnostics.url = archivesUrl;
        blitzDiagnostics.url = archivesUrl;
        return {
          rapid: { games24h: 0, games7d: 0, diagnostics: rapidDiagnostics },
          blitz: { games24h: 0, games7d: 0, diagnostics: blitzDiagnostics },
        };
      }

      const archivesData = await archivesResponse.json();
      const archives = archivesData.archives || [];

      // Get last 3 months to cover 7d window
      const recentArchives = archives.slice(-3);

      // Process each archive
      for (const archiveUrl of recentArchives) {
        try {
          const archiveController = new AbortController();
          const archiveTimeout = setTimeout(() => archiveController.abort(), 8000);

          const archiveResponse = await fetch(archiveUrl, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'RoboChess/1.0',
            },
            signal: archiveController.signal,
          });

          clearTimeout(archiveTimeout);

          if (archiveResponse.ok) {
            const text = await archiveResponse.text();
            const data: ChessComArchive = JSON.parse(text);

            // Set diagnostics from first successful archive
            if (rapidDiagnostics.status === null) {
              rapidDiagnostics.status = archiveResponse.status;
              rapidDiagnostics.contentType = archiveResponse.headers.get('content-type') || null;
              rapidDiagnostics.url = archiveUrl;
              rapidDiagnostics.bytes = Buffer.byteLength(text, 'utf8');
            }
            if (blitzDiagnostics.status === null) {
              blitzDiagnostics.status = archiveResponse.status;
              blitzDiagnostics.contentType = archiveResponse.headers.get('content-type') || null;
              blitzDiagnostics.url = archiveUrl;
              blitzDiagnostics.bytes = Buffer.byteLength(text, 'utf8');
            }

            // Count games by time_class and end_time
            for (const game of data.games || []) {
              if (game.time_class && game.end_time) {
                const endMs = game.end_time * 1000; // Convert seconds to milliseconds

                if (game.time_class === 'rapid') {
                  if (endMs >= since24hMs) {
                    rapid24h++;
                    rapid7d++;
                  } else if (endMs >= since7dMs) {
                    rapid7d++;
                  }
                } else if (game.time_class === 'blitz') {
                  if (endMs >= since24hMs) {
                    blitz24h++;
                    blitz7d++;
                  } else if (endMs >= since7dMs) {
                    blitz7d++;
                  }
                }
              }
            }

            // Add sample lines from first archive
            if (rapidDiagnostics.sampleLines.length === 0 && data.games && data.games.length > 0) {
              const sampleGame = JSON.stringify(data.games[0]);
              rapidDiagnostics.sampleLines = [
                sampleGame.length > 200 ? sampleGame.substring(0, 200) + '...' : sampleGame,
              ];
              blitzDiagnostics.sampleLines = [...rapidDiagnostics.sampleLines];
            }
          }
        } catch (e) {
          // Skip failed archive fetch
        }
      }

      // Set line counts (approximate - total games processed)
      rapidDiagnostics.lines = rapid24h + rapid7d;
      blitzDiagnostics.lines = blitz24h + blitz7d;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      rapidDiagnostics.error = fetchError instanceof Error ? fetchError.message : String(fetchError);
      blitzDiagnostics.error = rapidDiagnostics.error;
    }
  } catch (error) {
    rapidDiagnostics.error = error instanceof Error ? error.message : String(error);
    blitzDiagnostics.error = rapidDiagnostics.error;
  }

  return {
    rapid: { games24h: rapid24h, games7d: rapid7d, diagnostics: rapidDiagnostics },
    blitz: { games24h: blitz24h, games7d: blitz7d, diagnostics: blitzDiagnostics },
  };
}


