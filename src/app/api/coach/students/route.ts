import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export const revalidate = 0; // Disable cache to show fresh DB data immediately

export async function GET() {
  try {
    const students = await prisma.profiles.findMany({
      where: { role: "student" },
      include: {
        platform_connections: true,
        stats_snapshots: {
          orderBy: { captured_at: 'desc' },
          take: 1,
        },
      },
    });

    const formattedStudents = students.map((student) => {
      const connection = student.platform_connections.find(c => c.platform === 'lichess') || student.platform_connections[0];
      const latestStats = student.stats_snapshots[0];

      return {
        id: student.id,
        nickname: student.username || student.full_name || "Unnamed",
        platform: connection?.platform || "None",
        platform_username: connection?.platform_username || "",
        avatar_url: student.avatar_url,
        last_active: latestStats?.captured_at || connection?.last_synced_at || null,
        
        stats: {
            // RATINGS (new field names)
            rapidRating: latestStats?.rapid_rating ?? null,
            blitzRating: latestStats?.blitz_rating ?? null,
            puzzleRating: latestStats?.puzzle_rating ?? null,
            
            // DAILY STATS (new field names)
            rapidGames24h: latestStats?.rapid_24h ?? 0,
            blitzGames24h: latestStats?.blitz_24h ?? 0,
            
            // PUZZLES (new field names)
            puzzles3d: latestStats?.puzzle_24h ?? 0,
            puzzle_total: latestStats?.puzzle_total ?? 0,
        }
      };
    });

    return NextResponse.json(formattedStudents);
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
