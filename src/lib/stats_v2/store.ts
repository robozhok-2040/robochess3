import { prisma } from '@/lib/prisma';
import { Platform } from './types';

export interface StatsV2Data {
  rapid_24h: number;
  rapid_7d: number;
  blitz_24h: number;
  blitz_7d: number;
}

/**
 * Store stats v2 for a student/platform combination
 */
export async function storeStatsV2(
  studentId: string,
  platform: Platform,
  stats: StatsV2Data
): Promise<void> {
  await prisma.player_stats_v2.upsert({
    where: {
      student_id_platform: {
        student_id: studentId,
        platform: platform === 'chesscom' ? 'chesscom' : platform,
      },
    },
    update: {
      rapid_24h: stats.rapid_24h,
      rapid_7d: stats.rapid_7d,
      blitz_24h: stats.blitz_24h,
      blitz_7d: stats.blitz_7d,
      computed_at: new Date(),
    },
    create: {
      student_id: studentId,
      platform: platform === 'chesscom' ? 'chesscom' : platform,
      rapid_24h: stats.rapid_24h,
      rapid_7d: stats.rapid_7d,
      blitz_24h: stats.blitz_24h,
      blitz_7d: stats.blitz_7d,
      computed_at: new Date(),
    },
  });
}

