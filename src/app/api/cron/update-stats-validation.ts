/**
 * Runtime validation helper for update-stats route
 * Ensures 7d fields are always saved correctly
 */

import { prisma } from "@/lib/prisma";

/**
 * Validates that the latest snapshot for a user contains all required 7d fields
 * Returns true if valid, false if invalid (logs error)
 */
export async function validateSnapshotHas7dFields(userId: string): Promise<boolean> {
  try {
    const latestSnapshot = await prisma.stats_snapshots.findFirst({
      where: { user_id: userId },
      orderBy: { captured_at: 'desc' },
      take: 1,
    });

    if (!latestSnapshot) {
      return true; // No snapshot yet, nothing to validate
    }

    const hasAllFields = 
      latestSnapshot.rapid_7d !== null && latestSnapshot.rapid_7d !== undefined &&
      latestSnapshot.blitz_7d !== null && latestSnapshot.blitz_7d !== undefined &&
      latestSnapshot.puzzle_7d !== null && latestSnapshot.puzzle_7d !== undefined;

    if (!hasAllFields) {
      console.error(`[VALIDATION FAILED] User ${userId} snapshot missing 7d fields:`, {
        snapshotId: latestSnapshot.id,
        captured_at: latestSnapshot.captured_at,
        rapid_7d: latestSnapshot.rapid_7d,
        blitz_7d: latestSnapshot.blitz_7d,
        puzzle_7d: latestSnapshot.puzzle_7d,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[VALIDATION ERROR] Failed to validate snapshot for user ${userId}:`, error);
    return false;
  }
}


