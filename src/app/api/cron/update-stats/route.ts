import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const students = await prisma.profiles.findMany({
      where: { role: "student" },
      include: {
        platform_connections: { where: { platform: 'lichess' } },
        stats_snapshots: { orderBy: { captured_at: 'desc' }, take: 1 }
      }
    });

    const updates = [];

    for (const student of students) {
      const connection = student.platform_connections[0];
      if (!connection?.platform_username) continue;

      try {
        const response = await fetch(`https://lichess.org/api/user/${connection.platform_username}`);
        if (!response.ok) continue; 

        const data = await response.json();

        const latestSnapshot = student.stats_snapshots[0];

        // --- RAPID CALCULATION ---
        const currRapid = data.perfs?.rapid?.games ?? 0;
        const prevRapidTotal = latestSnapshot?.rapid_total ?? 0;
        
        // Cold Start: If history is missing/zero, delta is 0 (Calibration run).
        // Otherwise, calculate real difference.
        let rapidDelta = 0;
        if (prevRapidTotal > 0) {
            rapidDelta = Math.max(0, currRapid - prevRapidTotal);
        }

        // --- BLITZ CALCULATION ---
        const currBlitz = data.perfs?.blitz?.games ?? 0;
        const prevBlitzTotal = latestSnapshot?.blitz_total ?? 0;

        let blitzDelta = 0;
        if (prevBlitzTotal > 0) {
            blitzDelta = Math.max(0, currBlitz - prevBlitzTotal);
        }

        // --- PUZZLE CALCULATION ---
        const currPuzzle = data.perfs?.puzzle?.games ?? 0;
        const prevPuzzleTotal = latestSnapshot?.puzzle_total ?? 0;

        let puzzleDelta = 0;
        if (prevPuzzleTotal > 0) {
            puzzleDelta = Math.max(0, currPuzzle - prevPuzzleTotal);
        }

        // --- SAVE NEW SNAPSHOT ---
        await prisma.stats_snapshots.create({
          data: {
            user_id: student.id,
            source: "lichess", 
            
            // RATINGS
            rapid_rating: data.perfs?.rapid?.rating ?? null,
            blitz_rating: data.perfs?.blitz?.rating ?? null,
            puzzle_rating: data.perfs?.puzzle?.rating ?? null,

            // DAILY STATS (deltas)
            rapid_24h: rapidDelta,
            blitz_24h: blitzDelta,
            puzzle_24h: puzzleDelta,

            // LIFETIME ACCUMULATORS (for next delta calculation)
            rapid_total: currRapid,
            blitz_total: currBlitz,
            puzzle_total: currPuzzle,
            
            captured_at: new Date()
          }
        });

        updates.push(`${student.username}: RapidΔ=${rapidDelta}, BlitzΔ=${blitzDelta} (Totals: R=${currRapid}, B=${currBlitz})`);

      } catch (err) {
        console.error(err);
      }
    }

    return NextResponse.json({ summary: "Updated", details: updates });

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
