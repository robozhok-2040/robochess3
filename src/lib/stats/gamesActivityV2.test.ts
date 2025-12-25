/**
 * Tests for gamesActivityV2 module
 * Uses Vitest for testing with mocked fetch
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  computeFromLichess,
  computeFromChessCom,
  msSince,
  isWithin,
  safeJson,
  safeNdjsonLineParse,
} from './gamesActivityV2';

// Mock global fetch
global.fetch = vi.fn();

describe('gamesActivityV2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Date if needed
  });

  describe('Helper utilities', () => {
    it('msSince converts Date to milliseconds', () => {
      const date = new Date('2024-01-01T00:00:00Z');
      expect(msSince(date)).toBe(date.getTime());
    });

    it('isWithin checks if timestamp is within window', () => {
      const sinceMs = 1000;
      expect(isWithin(2000, sinceMs)).toBe(true);
      expect(isWithin(500, sinceMs)).toBe(false);
      expect(isWithin(1000, sinceMs)).toBe(true); // boundary
    });

    it('safeJson parses valid JSON', () => {
      expect(safeJson('{"key": "value"}')).toEqual({ key: 'value' });
    });

    it('safeJson returns null for invalid JSON', () => {
      expect(safeJson('invalid json')).toBeNull();
    });

    it('safeNdjsonLineParse parses valid line', () => {
      expect(safeNdjsonLineParse('{"key": "value"}')).toEqual({ key: 'value' });
    });

    it('safeNdjsonLineParse returns null for empty line', () => {
      expect(safeNdjsonLineParse('')).toBeNull();
      expect(safeNdjsonLineParse('   ')).toBeNull();
    });

    it('safeNdjsonLineParse returns null for invalid JSON', () => {
      expect(safeNdjsonLineParse('invalid')).toBeNull();
    });
  });

  describe('computeFromLichess', () => {
    it('counts rapid and blitz games correctly from NDJSON', async () => {
      const now = new Date('2024-01-15T12:00:00Z');
      const since24h = now.getTime() - 24 * 60 * 60 * 1000;
      const since7d = now.getTime() - 7 * 24 * 60 * 60 * 1000;

      // Rapid games: 2 in last 24h, 1 between 24h and 7d
      const rapidGame1 = { lastMoveAt: now.getTime() - 12 * 60 * 60 * 1000 }; // 12h ago (in 24h)
      const rapidGame2 = { lastMoveAt: now.getTime() - 6 * 60 * 60 * 1000 }; // 6h ago (in 24h)
      const rapidGame3 = { lastMoveAt: now.getTime() - 3 * 24 * 60 * 60 * 1000 }; // 3d ago (in 7d, not 24h)

      // Blitz games: 1 in last 24h, 2 between 24h and 7d
      const blitzGame1 = { lastMoveAt: now.getTime() - 8 * 60 * 60 * 1000 }; // 8h ago (in 24h)
      const blitzGame2 = { lastMoveAt: now.getTime() - 2 * 24 * 60 * 60 * 1000 }; // 2d ago (in 7d, not 24h)
      const blitzGame3 = { lastMoveAt: now.getTime() - 5 * 24 * 60 * 60 * 1000 }; // 5d ago (in 7d, not 24h)

      const rapidNdjson = [
        JSON.stringify(rapidGame1),
        JSON.stringify(rapidGame2),
        JSON.stringify(rapidGame3),
      ].join('\n');

      const blitzNdjson = [
        JSON.stringify(blitzGame1),
        JSON.stringify(blitzGame2),
        JSON.stringify(blitzGame3),
      ].join('\n');

      // Mock fetch for rapid
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: async () => rapidNdjson,
      });

      // Mock fetch for blitz
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: async () => blitzNdjson,
      });

      // Note: sleep happens between fetch calls, but since we're mocking fetch,
      // the actual delay doesn't affect test results. We can just await normally.
      const result = await computeFromLichess({ username: 'testuser', now });

      expect(result.rapid24h).toBe(2);
      expect(result.rapid7d).toBe(3);
      expect(result.blitz24h).toBe(1);
      expect(result.blitz7d).toBe(3);
      expect(result.computedAt).toBe(now.toISOString());
    });

    it('handles malformed lines gracefully', async () => {
      const now = new Date('2024-01-15T12:00:00Z');

      const ndjsonWithInvalidLines = [
        JSON.stringify({ lastMoveAt: now.getTime() - 12 * 60 * 60 * 1000 }),
        'invalid json line',
        JSON.stringify({ lastMoveAt: now.getTime() - 6 * 60 * 60 * 1000 }),
        '{ broken json',
      ].join('\n');

      // Mock fetch for rapid (return same for both calls)
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => ndjsonWithInvalidLines,
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => ndjsonWithInvalidLines,
        });

      const result = await computeFromLichess({ username: 'testuser', now });

      // Should count only valid games (2 per perf type)
      expect(result.rapid24h).toBe(2);
      expect(result.blitz24h).toBe(2);
    });

    it('includes Authorization header when token is provided', async () => {
      const now = new Date('2024-01-15T12:00:00Z');
      const token = 'test-token-123';

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '',
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '',
        });

      await computeFromLichess({ username: 'testuser', now, token });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('lichess.org'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${token}`,
          }),
        })
      );
    });

    it('handles fetch errors gracefully', async () => {
      const now = new Date('2024-01-15T12:00:00Z');

      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

      const result = await computeFromLichess({ username: 'testuser', now });

      // Should return zeros on error
      expect(result.rapid24h).toBe(0);
      expect(result.rapid7d).toBe(0);
      expect(result.blitz24h).toBe(0);
      expect(result.blitz7d).toBe(0);
    });

    it('handles non-ok response gracefully', async () => {
      const now = new Date('2024-01-15T12:00:00Z');

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      const result = await computeFromLichess({ username: 'testuser', now });

      expect(result.rapid24h).toBe(0);
      expect(result.rapid7d).toBe(0);
    });
  });

  describe('computeFromChessCom', () => {
    it('counts rapid and blitz games correctly from archives', async () => {
      const now = new Date('2024-01-15T12:00:00Z');
      const since24h = now.getTime() - 24 * 60 * 60 * 1000;
      const since7d = now.getTime() - 7 * 24 * 60 * 60 * 1000;

      // Archive URLs for current and previous month
      const archiveUrl1 = 'https://api.chess.com/pub/player/testuser/games/2024/01';
      const archiveUrl2 = 'https://api.chess.com/pub/player/testuser/games/2023/12';

      // Archive 1 games (2024/01)
      const archive1Games = [
        {
          time_class: 'rapid',
          end_time: Math.floor((now.getTime() - 12 * 60 * 60 * 1000) / 1000), // 12h ago
        },
        {
          time_class: 'rapid',
          end_time: Math.floor((now.getTime() - 2 * 24 * 60 * 60 * 1000) / 1000), // 2d ago
        },
        {
          time_class: 'blitz',
          end_time: Math.floor((now.getTime() - 6 * 60 * 60 * 1000) / 1000), // 6h ago
        },
      ];

      // Archive 2 games (2023/12)
      const archive2Games = [
        {
          time_class: 'blitz',
          end_time: Math.floor((now.getTime() - 5 * 24 * 60 * 60 * 1000) / 1000), // 5d ago
        },
        {
          time_class: 'rapid',
          end_time: Math.floor((now.getTime() - 10 * 24 * 60 * 60 * 1000) / 1000), // 10d ago (outside 7d)
        },
      ];

      // Mock archives list response
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            archives: [archiveUrl1, archiveUrl2, 'https://api.chess.com/pub/player/testuser/games/2023/11'],
          }),
      });

      // Mock archive 1 response
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ games: archive1Games }),
      });

      // Mock archive 2 response
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ games: archive2Games }),
      });

      const result = await computeFromChessCom({ username: 'testuser', now });

      // Expected counts:
      // Rapid: 1 in 24h (from archive1), 1 in 7d but not 24h (from archive1), 0 from archive2 (10d ago is outside)
      // Blitz: 1 in 24h (from archive1), 1 in 7d but not 24h (from archive2)
      expect(result.rapid24h).toBe(1);
      expect(result.rapid7d).toBe(2); // 1 in 24h + 1 between 24h and 7d
      expect(result.blitz24h).toBe(1);
      expect(result.blitz7d).toBe(2); // 1 in 24h + 1 between 24h and 7d
      expect(result.computedAt).toBe(now.toISOString());
    });

    it('filters archives to only fetch needed months', async () => {
      const now = new Date('2024-01-05T12:00:00Z'); // Early in month (day 5)

      const archives = [
        'https://api.chess.com/pub/player/testuser/games/2024/01', // current
        'https://api.chess.com/pub/player/testuser/games/2023/12', // previous
        'https://api.chess.com/pub/player/testuser/games/2023/11', // month before previous (needed since early in month)
        'https://api.chess.com/pub/player/testuser/games/2023/10', // should not be fetched
      ];

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ archives }),
      });

      // Mock archive responses (empty games)
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ games: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ games: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ games: [] }),
        });

      await computeFromChessCom({ username: 'testuser', now });

      // Should only fetch 3 archives (current, previous, and month before previous)
      expect(global.fetch).toHaveBeenCalledTimes(4); // 1 for archives list + 3 for archive files
    });

    it('only counts rapid and blitz time classes', async () => {
      const now = new Date('2024-01-15T12:00:00Z');
      const archiveUrl = 'https://api.chess.com/pub/player/testuser/games/2024/01';

      const games = [
        {
          time_class: 'rapid',
          end_time: Math.floor((now.getTime() - 12 * 60 * 60 * 1000) / 1000),
        },
        {
          time_class: 'blitz',
          end_time: Math.floor((now.getTime() - 6 * 60 * 60 * 1000) / 1000),
        },
        {
          time_class: 'classical', // Should be ignored
          end_time: Math.floor((now.getTime() - 12 * 60 * 60 * 1000) / 1000),
        },
        {
          time_class: 'bullet', // Should be ignored
          end_time: Math.floor((now.getTime() - 6 * 60 * 60 * 1000) / 1000),
        },
      ];

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ archives: [archiveUrl] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ games }),
        });

      const result = await computeFromChessCom({ username: 'testuser', now });

      // Should only count rapid and blitz
      expect(result.rapid24h).toBe(1);
      expect(result.blitz24h).toBe(1);
      expect(result.rapid7d).toBe(1);
      expect(result.blitz7d).toBe(1);
    });

    it('handles fetch errors gracefully', async () => {
      const now = new Date('2024-01-15T12:00:00Z');

      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

      const result = await computeFromChessCom({ username: 'testuser', now });

      expect(result.rapid24h).toBe(0);
      expect(result.rapid7d).toBe(0);
      expect(result.blitz24h).toBe(0);
      expect(result.blitz7d).toBe(0);
    });

    it('handles non-ok archives response gracefully', async () => {
      const now = new Date('2024-01-15T12:00:00Z');

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      const result = await computeFromChessCom({ username: 'testuser', now });

      expect(result.rapid24h).toBe(0);
      expect(result.rapid7d).toBe(0);
    });

    it('skips failed archive fetches and continues with others', async () => {
      const now = new Date('2024-01-15T12:00:00Z');
      const archiveUrl1 = 'https://api.chess.com/pub/player/testuser/games/2024/01';
      const archiveUrl2 = 'https://api.chess.com/pub/player/testuser/games/2023/12';

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ archives: [archiveUrl1, archiveUrl2] }),
        })
        .mockRejectedValueOnce(new Error('Archive 1 failed'))
        .mockResolvedValueOnce({
          ok: true,
          text: async () =>
            JSON.stringify({
              games: [
                {
                  time_class: 'rapid',
                  end_time: Math.floor((now.getTime() - 12 * 60 * 60 * 1000) / 1000),
                },
              ],
            }),
        });

      const result = await computeFromChessCom({ username: 'testuser', now });

      // Should count games from archive 2 despite archive 1 failing
      expect(result.rapid24h).toBe(1);
      expect(result.rapid7d).toBe(1);
    });
  });
});

