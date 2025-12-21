import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const students = await prisma.profiles.findMany({
      where: { role: "student" },
      include: {
        platform_connections: {
          where: { platform: 'lichess' }
        },
        stats_snapshots: {
          orderBy: { captured_at: 'desc' },
          take: 1
        }
      }
    });

    const report = students.map(s => {
      const lichess = s.platform_connections[0];
      const stats = s.stats_snapshots[0];

      return {
        id: s.id,
        Name: s.username || s.full_name || "No Name",
        Lichess_Login: lichess?.platform_username || "--- NOT LINKED ---",
        
        // ТЕ ЩО НАС ЦІКАВИТЬ:
        DATA_IN_DB: {
            RAPID: stats?.rapid_24h ?? 0,
            BLITZ: stats?.blitz_24h ?? 0, // Тут ми побачимо правду
            LAST_UPDATE: stats?.captured_at ? new Date(stats.captured_at).toLocaleString() : "NEVER"
        }
      };
    });

    return NextResponse.json({ 
      count: students.length, 
      students: report 
    });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
